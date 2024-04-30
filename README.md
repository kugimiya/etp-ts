
# ETP - Experimental Thread Pool

This is an experimental project created to practice a library for a thread pool, as well as for a stress test of this library in various scenarios


## Features

- Does not require a separate file for the logic of the worker
- TypeScript
- Zero dependencies
- async/await API

## Example

Sum 2 numbers, 32 times, on all cpu cores

```typescript
import { ETP } from 'etp-ts';
import { cpus } from 'node:os';

// worker logic
// SHOULD be async function named as 'main'
async function main(a, b) {
    return a + b;
}

// init ETP
const etp = new ETP(cpus().length, main);
await etp.init();

// every ETP's task is promise, so we should store them
const promises = [];

// do work, store tasks
for (const i = 0; i < 32; i++) {
    promises.push(etp.do_work(Math.random(), Math.random()));
}

// so, results is array of numbers
const results = await Promise.all(promises);
console.log(results);
```

## Run Locally

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


## Example of benchmark output

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
