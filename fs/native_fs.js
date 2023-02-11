// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"
import { NativeIo } from "../io/native_io.js"

export class NativeFs {
  #handle = null;
  #parentHandles = [];
  #path = [];

  async choose(writeAccess) {
    const options = writeAccess ? { mode: 'readwrite' } : undefined;
    this.#handle = await window.showDirectoryPicker(options);
  }

  async list(observer) {
    if (this.#parentHandles.length != 0) {
      this.#notifyEntry(observer, '..', true, null, 0);
    }
    for await (let [name, handle] of this.#handle) {
      const isFile = handle.kind == 'file';
      const file = isFile ? await handle.getFile() : null;
      this.#notifyEntry(
        observer,
        name,
        handle.kind == 'directory',
        file ? new Date(file.lastModified) : null,
        file ? file.size : 0);
    }
  }

  async chdir(name) {
    if (name == '..') {
      if (this.#parentHandles.length == 0) {
        throw Error.createNotFound();
      }
      this.#handle = this.#parentHandles.pop();
      this.#path.pop();
    } else {
      const handle = await this.#handle.getDirectoryHandle(name);
      if (!handle) {
        throw Error.createNotFound();
      }
      this.#path.push(name);
      this.#parentHandles.push(this.#handle);
      this.#handle = handle;
    }
  }

  async mkdir(name) {
    try {
      const handle = await this.#handle.getDirectoryHandle(name);
      if (handle) {
        throw Error.createInvalidRequest('already exist');
      }
    } catch (e) {
      if (e instanceof Error) {
        throw e;
      }
    }
    const handle = await this.#handle.getDirectoryHandle(name, { create: true });
    if (!handle) {
      throw Error.createInvalidRequest('cannot create');
    }
  }

  async remove(name) {
    await this.#handle.removeEntry(name);
  }

  async getIo(name, options) {
    try {
      const handle = await this.#handle.getFileHandle(name);
      if (!options || !options.create) {
        const io = new NativeIo();
        await io.open(handle);
        return io;
      }
      throw Error.createInvalidRequest('already exist');
    } catch (e) {
      if (e instanceof Error) {
        throw e;
      }
    }
    if (!options || !options.create) {
      throw Error.createInvalidRequest('not found');
    }
    const handle = await this.#handle.getFileHandle(name, { create: true });
    const io = new NativeIo();
    await io.open(handle);
    return io;
  }

  async getAttributes() {
    return {
      encoding: 'UCS-16',
      volumeLabel: this.#handle.name
    };
  }

  async getCwd() {
    return '/' + this.#path.join('/');
  }

  #notifyEntry(observer, name, directory, modified, size) {
    observer({
      name: name,
      writable: true,
      readable: true,
      system: false,
      volume: false,
      directory: directory,
      archive: false,
      created: null,
      accessed: null,
      modified: modified,
      size: size
    });
  }
}