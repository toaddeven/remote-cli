#!/usr/bin/env node
import { Command } from 'commander';
import { registerConfigCommands } from './commands/config';
import { startCommand } from './commands/start';

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

// Stop command (to be implemented with PM2 or similar)
program
  .command('stop')
  .description('Stop the router server')
  .action(() => {
    console.log('Stopping router server...');
    console.log('(Implementation pending - use Ctrl+C for now)');
  });

// Status command (to be implemented)
program
  .command('status')
  .description('Show router server status')
  .action(() => {
    console.log('Router server status:');
    console.log('(Implementation pending)');
  });

program.parse();
