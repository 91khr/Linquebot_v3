/** Build Typesctipt file */
/* eslint no-console: 'off' */

const commands = [
  'npx tsc',
  'npx tsc-alias',
  'cp config.yaml dist/config.yaml',
  'cp config.example.yaml dist/config.example.yaml',
  'cp -r locales dist/locales',
];

/*****************************************/

// import fs from 'fs';
// import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

function logCommand(message, func) {
  console.log(message);
  try {
    func();
  } catch (error) {
    console.log(chalk.red('[ERROR]'));
    console.log('--------------------------');
    if (error.stdout) {
      console.log(error.stdout.toString());
      throw error.message;
    } else {
      throw error;
    }
  }
}

commands.forEach((c) => {
  logCommand('> ' + c, () => {
    execSync(c, { stdio: 'inherit' });
  });
});

console.log('Build complete.');
