import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';

export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(a.trim()); }));
}

/** Prompt without echoing input (for passwords). ASCII assumed; fine for this use. */
export function askHidden(question: string): Promise<string> {
  return new Promise(res => {
    stdout.write(question);
    stdin.resume(); stdin.setRawMode?.(true);
    let buf = '';
    const onData = (d: Buffer) => {
      for (const byte of d) {
        if (byte === 3) { stdin.setRawMode?.(false); stdout.write('\n'); process.exit(1); } // Ctrl-C
        if (byte === 13 || byte === 10) {                                     // Enter
          stdin.setRawMode?.(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); return res(buf);
        }
        if (byte === 127 || byte === 8) buf = buf.slice(0, -1);               // Backspace
        else buf += String.fromCharCode(byte);
      }
    };
    stdin.on('data', onData);
  });
}
