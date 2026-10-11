/**
 * A short explanation of a Python or pygame error, next to the original line.
 *
 * The child sees the short sentence. The original text stays available for
 * 看代码. This does not decide whether a lesson step passed.
 */

const RULES: { test: RegExp; kid: string }[] = [
  { test: /IndentationError/, kid: "这一行的空格没有对齐。Python 靠空格知道哪些行是一组的。" },
  { test: /SyntaxError/, kid: "这句话 Python 读不懂。多半是少了冒号、引号或括号。" },
  { test: /NameError/, kid: "用到了一个还没有起过的名字。看看是不是拼写不一样。" },
  { test: /TypeError/, kid: "这个值和这种用法对不上，比如把文字当成了数字。" },
  { test: /ZeroDivisionError/, kid: "除数是 0。先确认那个数不是 0，再除。" },
  { test: /ModuleNotFoundError|ImportError/, kid: "没有找到要导入的东西。看看文件名和 import 是不是同一个。" },
  { test: /FileNotFoundError|No such file or directory/, kid: "没有找到这个文件。路径要和项目里的文件名一样。" },
  { test: /AttributeError/, kid: "这个东西没有你写的那个动作。看看是不是名字写错了。" },
  { test: /pygame\.error/i, kid: "pygame 没能完成这件事。常见原因是图片或声音的路径不对。" },
  { test: /time\.sleep|pygame\.time\.(wait|delay)/, kid: "这种等待会把页面卡住。改成 await asyncio.sleep(0)。" },
];

export type KidError = { kid: string; technical: string };

function match(technical: string): string | null {
  const rule = RULES.find((item) => item.test.test(technical));
  return rule?.kid ?? null;
}

/** The original diagnostic stays in `technical`. */
export function explainDiagnostic(message: string): KidError | null {
  const kid = match(message);
  if (!kid) return null;
  return { kid, technical: message };
}

/** The last error line in a console transcript, if we know how to say it. */
export function explainConsole(consoleText: string): KidError | null {
  const lines = consoleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const technical = [...lines].reverse().find((line) => match(line)) ?? "";
  if (!technical) return null;
  const kid = match(technical);
  if (!kid) return null;
  return { kid, technical };
}
