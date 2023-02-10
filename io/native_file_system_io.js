// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

export class NativeFileSystemIO {
  #handle = null;
  #file = null;
  #offset = 0;
  #writableStream = null;

  async getAttributes() {
    if (!this.#file) {
      throw Error.createNotOpen();
    }
    return {
      name: this.#handle.name,
      size: this.#file.size,
      lastModified: this.#file.lastModified
    };
  }

  async seek(offset) {
    this.#offset = offset;
  }

  async read(size) {
    if (!this.#file) {
      throw Error.createNotOpen();
    }
    const blob = this.#file.slice(this.#offset, this.#offset + size);
    const buffer = await blob.arrayBuffer();
    if (buffer.byteLength == 0) {
      return null;
    }
    this.#offset += buffer.byteLength;
    return buffer;
  }

  async write(buffer) {
    if (!this.#file) {
      throw Error.createNotOpen();
    }
    if (!this.#writableStream) {
      await this.#requestWriteAccess();
    }
    if (!buffer instanceof ArrayBuffer) {
      throw Error.createInvalidBuffer();
    }
    await this.#writableStream.seek(this.#offset);
    await this.#writableStream.write(buffer);
    this.#offset += buffer.byteLength;
  }

  async truncate(size) {
    if (!this.#file) {
      throw Error.createNotOpen();
    }
    if (!this.#writableStream) {
      await this.#requestWriteAccess();
    }
    await this.#writableStream.truncate(size);
    if (this.#offset > size) {
      this.#offset = size;
    }
  }

  async flush() {
  }

  async close() {
    this.#writableStream.close();
    this.#file = null;
    this.#handle = null;
    this.#writableStream = null;
    this.#offset = 0;
  }

  async choose() {
    this.#handle = (await window.showOpenFilePicker({
      multiple: false
    }))[0];
    this.#file = await this.#handle.getFile();
  }

  async #requestWriteAccess() {
    this.#writableStream = await this.#handle.createWritable({
      keepExistingData: true
    });
  }
}