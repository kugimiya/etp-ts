# ETP - Experimental Thread Pool

This is an experimental project created to practice a library for a thread pool, as well as for a stress test of this library in various scenarios

## Features

- Does not require a separate file for the logic of the worker
- TypeScript
- Zero dependencies
- async/await API

## Requirements And Advices
### Requirements
`worker` code should be (see Example section):
- placed in async function
- take one argument
- should be named as `main`
### Advices
- if the result of parallelization is composed in an array, I recommend that this array as SharedArrayBuffer be transferred to worker, and mutate it there
- it also is related to sending large arrays to workers (>100 items); remember that node.js serves as sending to workers, so the serialization of arrays really consumes a lot of CPU time, and almost always in this case you need to use SharedArrayBuffer
- remember that the main thread has bottleneck to send a large number of tasks to workers; so, if you send more than 10,000 tasks in one cycle, then the main thread simply will not have time to send tasks and take results, smoothly distributing the load on workers

## The Results Of The Experiment

The scenario of the use of multi-thread iteration was revealed, which consumes more time of the processor than a single-thread iteration.

This case is characterized by the fact that we send:
1. a lot of data to the stream,
2. we get a lot of data back,
3. in addition, we send a lot of tasks in thread pool.

The main part of the processing time is spent in parent thread, specifically at the stage of serialization of data. You can see this by looking at benchmark suite number 2.

*Not everything is so bad!* There is optimization, and it consists in using SharedArrayBuffer, look at benchmark suite number 3.

## Example

Sum 2 numbers, 32 times, on all cpu cores

```typescript
import { ETP } from 'etp-ts';
import { cpus } from 'node:os';

// worker logic
// SHOULD be async function named as 'main'
async function main([a, b]: [number, number]) {
    return a + b;
}

// init ETP
const etp = new ETP(cpus().length, main);
await etp.init();

// every ETP's task is promise, so we should store them
const promises: Promise<number>[] = [];

// do work, store tasks
for (const i = 0; i < 32; i++) {
    promises.push(etp.do_work(Math.random(), Math.random()));
}

// so, results is array of numbers
const results = await Promise.all(promises);
console.log(results);

// then, close thread pool
etp.terminate();
```

## Known Issues

### __awaiter is not defined
Also known as: `ReferenceError [Error]: __awaiter is not defined`. This happen bcause typescript compiler emit polyfills into source code, and `main` function got referrence to some polyfills; one of them is `__awaiter`.
### Fix
Tune `tsconfig.json`, section `compilerOptions` > `target` should be `es2020` or greater ES version.

## Run Benchmark Locally

Clone the project

```bash
  git clone https://github.com/kugimiya/etp-ts
```

Go to the project directory

```bash
  cd etp-ts
```

Install dependencies

```bash
  npm install
```

Start benchmark

```bash
  npm run start-benchmark
```


## Example Of Benchmark Output

```logs
Benchmark suite #1: heavy computation, 4096 tasks, small task payload

 Start parallel work...
  parallel work ends, time taken: 4282ms
 Start single thread work...
  single thread work ends, time taken: 25277ms


Benchmark suite #2: semi-heavy computation, 4096 tasks, big task payload (2 arrays of 16000 ints),
big task result (1 array of 16000 floats)

 Start parallel work...
  parallel work ends, time taken: 7331ms
 Start single thread work...
  single thread work ends, time taken: 802ms


Benchmark suite #3: heavy computation, 8192 tasks, SharedArrayBuffer task payload (2 arrays of 16000 ints),
SharedArrayBuffer task result (1 array of 16000 floats)

 Start parallel work...
  parallel work ends, time taken: 879ms
 Start single thread work...
  single thread work ends, time taken: 2430ms
```
