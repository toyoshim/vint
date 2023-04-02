// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

const errorMessages = {
  0: '予期しないエラー',
  1: '開けない',
  2: '予期しないエラー（バッファー）',
  3: '予期しないエラー（リクエスト）',
  4: '未知のファイル形式',
  5: '見つからない',
  6: '空き容量不足',
  7: '名前が不正',
  8: 'ディレクトリが空ではない',
  9: '予期しないエラー（ディスクイメージ）',
  10: '書き込み禁止'
};

export const Message = {
  labelHelp: '🤔 操作方法',
  labelMountNative: '📂 接続',
  labelMountImage: '💾 接続',
  labelCopy: '🗒 コピー',
  labelDelete: '🗒 削除',
  labelMkdir: '📂 作成',

  tipHelp: '使い方を解説したウェブページを開きます',
  tipMountNative: 'コンピュータ上のディレクトリを選択してvint上で表示できるようにします',
  tipMountImage: 'ディスクイメージを選択してvint上で表示できるようにします',
  tipCopy: `選択したファイルのコピーをします
（ショートカット: C）`,
  tipDelete: `選択したファイルやディレクトリを削除します
（ショートカット: K）`,
  tipMkdir: `ディレクトリを作成します
（ショートカット: M）`,

  messageDisclaimer: `【注意】

このアプリケーションはコンピュータ上のデータに対してコピーや削除等の破壊的な操作を行います。特にディスクイメージ内の操作は、本来OSのような責任あるソフトウェアが行うような操作を直接行っています。時には大切なデータを破壊するようなバグに遭遇する可能性がある事に留意してご使用ください。

使用前に操作対象ファイルのバックアップを取ることをお薦めします。`,
  messageBackup: `バックアップは忘れずに！`,
  messageMkdir: `作成するディレクトリの名前を入力してください`,
  messageReady: `VINT Ready: はじめての方は 🤔 操作方法 をクリックしてください`,
  messageCancelled: `キャンセルされました`,
  messageOk: `成功`,
  messageFail: `失敗`,

  getErrorMessage: e => {
    if (errorMessages[e.id]) {
      return errorMessages[e.id];
    }
    return errorMessages[0];
  }
};