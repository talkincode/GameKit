import type { SignInNote } from "../lib/account";

/**
 * Kid-facing copy. New interface text goes here, not inline in components.
 * Short sentences, no blame; technical detail stays out of these strings.
 */
export const text = {
  account: {
    signIn: "登录",
    signOut: "退出",
    checking: "正在确认登录…",
    offline: "现在没联网，小助手暂时休息。做游戏不受影响。",
    unavailable: "登录服务还没准备好。做游戏不受影响。",
    notes: {
      denied: "这个账号还没有开通 GameKit。请让家长或老师帮你开通。",
      failed: "这次没有登录成功，再试一次吧。",
      expired: "登录已经过期了，重新登录就好。",
      unavailable: "登录服务还没准备好。做游戏不受影响。",
      "signed-out": "已经退出登录。你的作品还在这台电脑上。",
    } satisfies Record<SignInNote, string>,
  },
  ai: {
    needsSignIn: "登录后，小助手可以帮你写代码、找 bug、画素材。",
    signInToUse: "登录后使用小助手",
    failed: "小助手这次没想好，再试一次吧。",
  },
};
