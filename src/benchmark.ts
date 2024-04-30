import { cpus } from 'node:os';
import { ETP } from './';

async function suite_1() {
  async function main(for_limit: number) {
    const start_time = Date.now();
    let cnt = 0;

    for (let i = 0; i < for_limit; i++) {
      cnt += Math.random();
    }

    return Date.now() - start_time;
  }

  const etp = new ETP(cpus().length, main);
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

async function suite_2() {
  async function main([array1, array2]: [number[], number[]]) {
    const result = new Array(array1.length).fill(0);
    const start_time = Date.now();

    for (let i = 0; i < array1.length; i++) {
      result[i] = array1[i] * array2[i] * Math.random();
    }

    return [Date.now() - start_time, result];
  }

  const etp = new ETP(cpus().length, main);
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

async function suite_3() {
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

  const etp = new ETP(cpus().length, main);
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
