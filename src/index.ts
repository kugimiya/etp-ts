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
    this.threads_ports.forEach(_ => _.close());
    this.threads.forEach(_ => _.terminate());
  }
}

async function suite_1 () {
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
  console.log('Benchmark suite #1: heavy computation, 4096 tasks, small task payload\n');

  console.log(' Start parallel work...');
  for (let i = 0; i < 4096; i++) {
    promises.push(etp.do_work(1_000_000));
  }
  await Promise.all(promises);
  console.log(`  parallel work ends, time taken: ${Date.now() - main_start}ms`);
  etp.terminate();

  main_start = Date.now();
  console.log(' Start single thread work...');
  for (let i = 0; i < 4096; i++) {
    await main(1_000_000);
  }

  console.log(`  single thread work ends, time taken: ${Date.now() - main_start}ms \n\n`);
}

async function suite_2 () {
  async function main([array1, array2]: [number[], number[]]) {
    const result = new Array(array1.length).fill(0);
    const start_time = Date.now();

    for (let i = 0; i < array1.length; i++) {
      result[i] = array1[i] * array2[i] * Math.random();
    }

    return [Date.now() - start_time, result];
  }

  const etp = new ETP_001(os.cpus().length, main);
  await etp.init();

  let main_start = Date.now();
  const promises = [];
  console.log('Benchmark suite #2: semi-heavy computation, 4096 tasks, big task payload (2 arrays of 16000 ints), big task result (1 array of 16000 floats)\n');

  console.log(' Start parallel work...');
  const array1 = new Array(16000).fill(0).map(() => Math.round(Math.random() * 10));
  const array2 = new Array(16000).fill(0).map(() => Math.round(Math.random() * 10));
  for (let i = 0; i < 4096; i++) {
    promises.push(etp.do_work([array1, array2]));
  }
  await Promise.all(promises);
  console.log(`  parallel work ends, time taken: ${Date.now() - main_start}ms`);
  etp.terminate();

  main_start = Date.now();
  console.log(' Start single thread work...');
  for (let i = 0; i < 4096; i++) {
    await main([array1, array2]);
  }

  console.log(`  single thread work ends, time taken: ${Date.now() - main_start}ms \n\n`);
}

async function suite_3 () {
  async function main([array1_shared, array2_shared, result_array_shared]: [SharedArrayBuffer, SharedArrayBuffer, SharedArrayBuffer]) {
    const start_time = Date.now();
    const array1 = new Int32Array(array1_shared);
    const array2 = new Int32Array(array2_shared);
    const result_array = new Float64Array(result_array_shared);

    for (let i = 0; i < array1.length; i++) {
      result_array[i] = array1[i] * array2[i] * Math.random();
    }

    return [Date.now() - start_time];
  }

  const etp = new ETP_001(os.cpus().length, main);
  await etp.init();

  let main_start = Date.now();
  const promises = [];
  console.log('Benchmark suite #3: heavy computation, 8192 tasks, SharedArrayBuffer task payload (2 arrays of 16000 ints), SharedArrayBuffer task result (1 array of 16000 floats)\n');

  console.log(' Start parallel work...');
  const array1_shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 16000);
  const array2_shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 16000);
  const array1 = new Int32Array(array1_shared);
  const array2 = new Int32Array(array2_shared);

  for (let i = 0; i < array1.length; i++) {
    array1[i] = Math.round(Math.random() * 10);
    array2[i] = Math.round(Math.random() * 10);
  }

  for (let i = 0; i < 8192; i++) {
    const result_array_shared = new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * 16000);
    const result_array = new Float64Array(result_array_shared);
    result_array.fill(0);

    promises.push(etp.do_work([array1_shared, array2_shared, result_array_shared]));
  }

  await Promise.all(promises);
  console.log(`  parallel work ends, time taken: ${Date.now() - main_start}ms`);
  etp.terminate();

  main_start = Date.now();
  console.log(' Start single thread work...');
  for (let i = 0; i < 8192; i++) {
    const result_array_shared = new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * 16000);
    const result_array = new Float64Array(result_array_shared);
    result_array.fill(0);

    await main([array1_shared, array2_shared, result_array_shared]);
  }

  console.log(`  single thread work ends, time taken: ${Date.now() - main_start}ms \n\n`);
}

suite_1().then(suite_2).then(suite_3).catch(console.error);
