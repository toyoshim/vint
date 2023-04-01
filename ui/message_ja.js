// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

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
（ショートカット: D）`,
  tipMkdir: `ディレクトリを作成します
（ショートカット: K）`,

  messageDisclaimer: `【注意】

このアプリケーションはコンピュータ上のデータに対してコピーや削除等の破壊的な操作を行います。特にディスクイメージ内の操作は、本来OSのような責任あるソフトウェアが行うような操作を直接行っています。時には大切なデータを破壊するようなバグに遭遇する可能性がある事に留意してご使用ください。

使用前に操作対象ファイルのバックアップを取ることをお薦めします。`,
  messageMkdir: `作成するディレクトリの名前を入力してください`
};