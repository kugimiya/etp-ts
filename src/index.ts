import worker_threads, { Worker, parentPort } from 'node:worker_threads';
import EventEmitter from "node:events";
import * as os from "node:os";

type ToWorkerMessage<WorkerPayload> = {
  type: 'do_work',
  payload: {
    task_id: number,
    task_data: WorkerPayload,
  }
};

type ToParentMessage<WorkerResult> = {
  type: 'worker_port',
  payload: MessagePort,
} | {
  type: 'worker_result',
  payload: {
    task_id: number,
    result: WorkerResult
  },
};

function worker_logic<WorkerPayload>() {
  'use main';

  const { parentPort, MessageChannel } = require('node:worker_threads');
  const worker_channel = new MessageChannel();

  worker_channel.port1.on('message', (message: ToWorkerMessage<WorkerPayload>) => {
    if (message.type === 'do_work') {
      // @ts-ignore cause main will be defined in 'use main'; section at runtime
      (main as (...args: any) => Promise<any>)(message.payload.task_data)
        .then(result => parentPort?.postMessage({
          type: 'worker_result',
          payload: { task_id: message.payload.task_id, result }
        }));
    }
  });

  parentPort.postMessage({ type: 'worker_port', payload: worker_channel.port2 }, [worker_channel.port2]);
}

class ETP_001<WorkerPayload, WorkerResult> {
  task_id_counter = 0;

  threads: Worker[] = [];
  threads_ports: MessagePort[] = [];
  threads_promise_resolvers: Record<number, (result: WorkerResult) => void> = {};
  threads_to_task_id_map: Record<number, number> = {};

  task_events: EventEmitter = new EventEmitter();
  tasks: Record<number, (port: MessagePort) => void> = {};

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
      const worker_code = worker_logic.toString()
        .replace(`'use main';`, main_as_text);

      const thread = new worker_threads.Worker(`(${worker_code})();`, { eval: true });
      this.threads.push(thread);

      thread.on('message', (message: ToParentMessage<WorkerResult>) => {
        if (message.type === 'worker_port') {
          this.threads_ports.push(message.payload);
          received_ports_count += 1;

          if (received_ports_count === this.threads.length) {
            promise_resolver();
          }
        }

        if (message.type === 'worker_result') {
          const { task_id, result } = message.payload;
          delete this.threads_to_task_id_map[task_id];
          if (this.threads_promise_resolvers[task_id]) {
            this.threads_promise_resolvers[task_id](result);
            delete this.threads_promise_resolvers[task_id];
          }
          this.task_events.emit(`task_complete`, task_id);
        }
      });
    }

    return promise;
  }

  do_work(task_data: WorkerPayload): Promise<WorkerResult> {
    const task_id = ++this.task_id_counter;

    return new Promise((resolve) => {
      this.threads_promise_resolvers[task_id] = resolve;
      this.tasks[task_id] = (thread_port: MessagePort) => {
        thread_port.postMessage({ type: 'do_work', payload: { task_id, task_data } })
      };
      this.task_events.emit(`task_added`, task_id);
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
        task(this.threads_ports[thread_index]);
        delete this.tasks[task_id];
      }
    }
  }

  terminate() {
    this.threads.forEach(_ => _.terminate());
  }
}

async function app_main () {
  async function main(for_limit: number) {
    const start_time = Date.now();
    let cnt = 0;

    for (let i = 0; i < for_limit; i++) {
      cnt += Math.random();
    }

    return Date.now() - start_time;
  }

  const etp = new ETP_001(os.cpus().length, main);
  await etp.init();

  let main_start = Date.now();
  const promises = [];
  console.log('Start parallel work');
  for (let i = 0; i < 4096; i++) {
    promises.push(etp.do_work(1_000_000));
  }
  await Promise.all(promises);
  console.log(`Parallel work ends, time taken: ${Date.now() - main_start}`);
  etp.terminate();

  main_start = Date.now();
  console.log('Start single thread work');
  for (let i = 0; i < 4096; i++) {
    await main(1_000_000);
  }

  console.log(`Single thread work ends, time taken: ${Date.now() - main_start}`);
}

app_main().catch(console.error);
