// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

export class RootFs {
  #fs = [];
  #nameMap = {};
  #current = -1;

  async mount(fs) {
    const label = (await fs.getAttributes()).volumeLabel;
    if (this.#nameMap[label]) {
      throw Error.createNotImplemented('mount name conflicts');
    }
    this.#nameMap[label] = fs;
    this.#fs.push(fs);
  }

  async list(observer) {
    if (this.#current >= 0) {
      await this.#fs[this.#current].list(observer);
      return;
    }
    for (let fs of this.#fs) {
      const label = (await fs.getAttributes()).volumeLabel;
      observer({
        name: label,
        writable: true,
        readable: true,
        system: false,
        volume: false,
        directory: true,
        archive: false,
        created: null,
        accessed: null,
        modified: null,
        size: 0,
        mount: true
      });
    }
  }

  async chdir(name) {
    if (this.#current >= 0) {
      await this.#fs[this.#current].chdir(name).catch(e => {
        if ((name != '..') || (e.id != Error.notFound)) {
          throw e;
        }
        this.#current = -1;
      });
      return;
    }
    for (let i = 0; i < this.#fs.length; ++i) {
      const label = (await this.#fs[i].getAttributes()).volumeLabel;
      if (label != name) {
        continue;
      }
      this.#current = i;
      return;
    }
    throw Error.createNotFound();
  }

  async mkdir(name) {
    if (this.#current >= 0) {
      await this.#fs[this.#current].mkdir(name);
      return;
    }
    throw Error.createInvalidRequest();
  }

  async remove(name) {
    if (this.#current >= 0) {
      await this.#fs[this.#current].remove(name);
      return;
    }
    throw Error.createInvalidRequest();
  }

  async getIo(name, options) {
    if (this.#current >= 0) {
      return await this.#fs[this.#current].getIo(name, options);
    }
    throw Error.createInvalidRequest();
  }

  async flush() {
    if (this.#current >= 0) {
      return await this.#fs[this.#current].flush();
    }
  }

  async close() {
    throw Error.createInvalidRequest();
  }

  async getAttributes() {
    return {
      encoding: 'UTF-2',
      volumeLabel: 'Root'
    };
  }

  async getCwd() {
    if (this.#current >= 0) {
      return await this.#fs[this.#current].getCwd();
    }
    return '/';
  }
}