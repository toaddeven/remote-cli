/**
 * Strip ANSI escape sequences from a string
 *
 * ANSI escape sequences are used for terminal colors and formatting.
 * They look like: \x1B[0m, \x1B[31m, etc.
 *
 * This regex matches:
 * - \x1B or \u001B: ESC character
 * - \[: Opening bracket
 * - [0-9;]*: Any number of digits and semicolons (parameters)
 * - [a-zA-Z]: The command letter
 *
 * @param text Text that may contain ANSI escape sequences
 * @returns Text with ANSI escape sequences removed
 *
 * @example
 * stripAnsi('\x1B[31mRed Text\x1B[0m') // Returns: "Red Text"
 * stripAnsi('[7m [1m [36m RUN [39m') // Returns: " RUN "
 */
export function stripAnsi(text: string): string {
  if (!text) {
    return text;
  }

  // Match ANSI escape sequences: ESC [ parameters command
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}
