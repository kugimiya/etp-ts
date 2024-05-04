import { Worker } from 'node:worker_threads';
import { EventEmitter } from "node:events";
import { readFileSync } from 'node:fs';

enum ToWorkerMessageType {
  DoWork
}

type ToWorkerMessage<WorkerPayload> = {
  type: ToWorkerMessageType,
  payload: {
    task_id: number,
    task_data: WorkerPayload,
  }
};

enum ToParentMessageType {
  WorkerPort,
  WorkerResult
}

type ToParentMessage<WorkerResult> = {
  type: ToParentMessageType.WorkerPort,
  payload: MessagePort,
} | {
  type: ToParentMessageType.WorkerResult,
  payload: {
    task_id: number,
    result: WorkerResult
  },
};

function worker_logic<WorkerPayload>() {
  'use main';

  const { parentPort } = require('node:worker_threads');

  parentPort.on('message', (message: ToWorkerMessage<WorkerPayload>) => {
    if (message.type === ToWorkerMessageType.DoWork) {
      // @ts-ignore cause main will be defined in 'use main'; section at runtime
      (main as (...args: any) => Promise<any>)(message.payload.task_data)
        .then(result => parentPort?.postMessage({
          type: ToParentMessageType.WorkerResult,
          payload: { task_id: message.payload.task_id, result }
        }));
    }
  });

  parentPort.postMessage({ type: ToParentMessageType.WorkerPort, payload: undefined });
}

export class ETP<WorkerPayload, WorkerResult> {
  task_id_counter = 0;

  threads: Worker[] = [];
  threads_promise_resolvers: Record<number, (result: WorkerResult) => void> = {};
  threads_to_task_id_map: Record<number, number> = {};

  task_events: EventEmitter = new EventEmitter();
  tasks: Record<number, (worker: Worker) => void> = {};

  constructor(protected count: number, protected worker_main: (data: WorkerPayload) => Promise<WorkerResult>) {
    if (this.worker_main.name !== 'main') {
      throw new Error('worker_main must be a named async function with name="main"');
    }

    // setup task loopin'
    this.task_events.on('task_complete', (task_id: number) => {
      this.try_to_emit_next_task();
    });

    this.task_events.on('task_added', (task_id: number) => {
      this.try_to_emit_next_task();
    });
  }

  init(): Promise<void> {
    let received_ports_count = 0;
    let promise_resolver: () => void;
    let promise = new Promise<void>((resolve) => {
      promise_resolver = resolve;
    });

    // setup workers
    for (let i = 0; i < this.count; i++) {
      const main_as_text = this.worker_main.toString();
      const worker_code = readFileSync(__filename).toString()
        .replace(`'use` + ` main';`, main_as_text) + `\n worker_logic();`;

      const thread = new Worker(worker_code, { eval: true });
      this.threads.push(thread);

      thread.on('message', (message: ToParentMessage<WorkerResult>) => {
        if (message.type === ToParentMessageType.WorkerPort) {
          received_ports_count += 1;

          if (received_ports_count === this.threads.length) {
            promise_resolver();
          }
        }

        if (message.type === ToParentMessageType.WorkerResult) {
          const { task_id, result } = message.payload;
          delete this.threads_to_task_id_map[task_id];
          if (this.threads_promise_resolvers[task_id]) {
            this.threads_promise_resolvers[task_id](result);
            delete this.threads_promise_resolvers[task_id];
          }
          this.task_events.emit('task_complete', task_id);
        }
      });
    }

    return promise;
  }

  do_work(task_data: WorkerPayload): Promise<WorkerResult> {
    const task_id = ++this.task_id_counter;

    return new Promise((resolve) => {
      this.threads_promise_resolvers[task_id] = resolve;
      this.tasks[task_id] = (worker: Worker) => {
        worker.postMessage({ type: ToWorkerMessageType.DoWork, payload: { task_id, task_data } })
      };
      this.task_events.emit('task_added', task_id);
    });
  }

  try_to_emit_next_task() {
    const unavailable_threads = Object.values(this.threads_to_task_id_map);
    const available_threads = Object.keys(this.threads)
      .map(_ => Number(_))
      .filter(_ => !unavailable_threads.includes(_));

    if (available_threads.length > 0 && Object.keys(this.tasks).length > 0) {
      const thread_index = available_threads.pop();
      const task_id = Object.keys(this.tasks).pop() as unknown as keyof typeof this.tasks;
      const task = this.tasks[task_id];

      if (thread_index != null && task_id != null) {
        this.threads_to_task_id_map[task_id] = thread_index;
        task(this.threads[thread_index]);
        delete this.tasks[task_id];
      }
    }
  }

  terminate() {
    for (const thread of this.threads) {
      thread.terminate();
    }
  }
}
