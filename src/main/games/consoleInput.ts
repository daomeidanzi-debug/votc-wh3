import { execFile } from 'child_process';

/**
 * Types a console command into the game window that is in front (Windows only).
 *
 * Paradox games open the console with the key below Esc (scan code 0x29, whatever the
 * keyboard layout prints on it), so the sequence is: console key, the command as Unicode
 * text, Enter, console key again. SendInput feeds the same input queue as the keyboard,
 * which is what DirectX/SDL games read; the game must be the foreground window.
 */

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class VotcKeys {
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  const uint KEYUP = 0x2, UNICODE = 0x4, SCANCODE = 0x8;
  static void Send(ushort scan, uint flags) {
    var i = new INPUT[1];
    i[0].type = 1; i[0].ki.wScan = scan; i[0].ki.dwFlags = flags;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  static void Tap(ushort scan) { Send(scan, SCANCODE); Thread.Sleep(30); Send(scan, SCANCODE | KEYUP); Thread.Sleep(30); }
  public static void Run(string text) {
    Tap(0x29); Thread.Sleep(350);
    foreach (char c in text) { Send(c, UNICODE); Send(c, UNICODE | KEYUP); Thread.Sleep(15); }
    Thread.Sleep(80); Tap(0x1C); Thread.Sleep(400); Tap(0x29);
  }
}
"@
[VotcKeys]::Run($env:VOTC_CONSOLE_TEXT)
`;

let busy = false;

/** Resolves true when the keys were sent. Never throws. */
export function typeConsoleCommand(command: string): Promise<boolean> {
  if (process.platform !== 'win32' || busy) return Promise.resolve(false);
  // only plain console commands (letters, digits, spaces, dots, underscores)
  if (!/^[A-Za-z0-9 ._\\/-]{1,80}$/.test(command)) return Promise.resolve(false);
  busy = true;
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 20000, env: { ...process.env, VOTC_CONSOLE_TEXT: command } },
      (error) => {
        busy = false;
        if (error) console.warn('consoleInput: could not type into the game console:', error.message);
        resolve(!error);
      }
    );
  });
}
