// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

export class NativeFs {
  #handle = null;

  async choose() {
    this.#handle = await window.showDirectoryPicker();
  }

  async list(observer) {
    for await (let [name, handle] of this.#handle) {
      const isFile = handle.kind == 'file';
      const file = isFile ? await handle.getFile() : null;
      observer({
        name: name,
        writable: true,
        readable: true,
        system: false,
        volume: false,
        directory: handle.kind == 'directory',
        archive: false,
        created: null,
        accessed: null,
        modified: file ? new Date(file.lastModified) : null,
        size: file ? file.size : 0,
        handle: handle
      });
    }
  }

  async getAttributes() {
    return {
      encoding: 'UCS-16'
    };
  }
}