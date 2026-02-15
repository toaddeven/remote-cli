#!/usr/bin/env node
import { Command } from 'commander';
import { registerConfigCommands } from './commands/config';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { statusCommand } from './commands/status';

const program = new Command();

program
  .name('remote-cli-router')
  .description('Router server for remote CLI')
  .version('1.0.0');

// Register config commands
registerConfigCommands(program);

// Start command
program
  .command('start')
  .description('Start the router server')
  .action(startCommand);

// Stop command
program
  .command('stop')
  .description('Stop the router server')
  .action(stopCommand);

// Status command
program
  .command('status')
  .description('Show router server status')
  .action(statusCommand);

program.parse();
