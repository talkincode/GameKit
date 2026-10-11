import { describe, expect, it } from "vitest";
import { explainConsole, explainDiagnostic } from "./kid-error";

describe("kid-facing errors", () => {
  it("explains a NameError and keeps the original line", () => {
    const error = explainConsole('Traceback (most recent call last):\n  File "main.py", line 3\nNameError: name \'x\' is not defined');
    expect(error?.kid).toContain("名字");
    expect(error?.technical).toContain("NameError");
  });

  it("explains a missing file, a pygame error, and a blocking sleep", () => {
    expect(explainDiagnostic("FileNotFoundError: [Errno 2] No such file or directory: 'assets/hero.png'")?.kid).toContain(
      "文件",
    );
    expect(explainConsole("pygame.error: Couldn't open assets/jump.wav")?.kid).toContain("路径");
    expect(explainDiagnostic("time.sleep blocks the browser tab. Use await asyncio.sleep(...).")?.kid).toContain(
      "卡住",
    );
  });

  it("stays quiet when the line is not an error we know", () => {
    expect(explainConsole("RECIPE-OK platform\n")).toBeNull();
    expect(explainDiagnostic("The web runtime starts at main.py.")).toBeNull();
  });
});
