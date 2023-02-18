// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"
import { FatFs } from "./fat_fs.js"

export class MultiImageFs {
  #images = [];
  #fs = null;
  #name = '';

  async open(image) {
    if (this.#images.length != 0) {
      throw Error.createInvalidRequest('already open');
    }
    const attributes = await image.getAttributes();
    this.#name = attributes.name;
    if (!attributes.bundles) {
      this.#images.push(image);
    } else {
      for (let i = 0; i < attributes.bundles; ++i) {
        this.#images.push(await image.getImage(i));
      }
    }
  }

  async list(observer) {
    if (this.#fs) {
      await this.#fs.list(observer);
      return;
    }
    for (let image of this.#images) {
      console.log(image);
      const attributes = await image.getAttributes();
      observer({
        name: attributes.name,
        writable: false,
        readable: true,
        system: false,
        volume: false,
        directory: true,
        archive: false,
        created: null,
        accessed: null,
        modified: null,
        size: attributes.size,
        mount: true
      });
    }
  }

  async chdir(name) {
    if (this.#fs) {
      await this.#fs.chdir(name).catch(e => {
        if ((name != '..') || (e.id != Error.notFound)) {
          throw e;
        }
        this.#fs = null;
      });
      return;
    }
    for (let i = 0; i < this.#images.length; ++i) {
      const label = (await this.#images[i].getAttributes()).name;
      if (label != name) {
        continue;
      }
      const fs = new FatFs();
      await fs.open(this.#images[i]);
      this.#fs = fs;
      return;
    }
    throw Error.createNotFound();
  }

  async mkdir(name) {
    if (this.#fs) {
      await this.#fs.mkdir(name);
      return;
    }
    throw Error.createWriteProtected();
  }

  async remove(name) {
    if (this.#fs) {
      await this.#fs.remove(name);
      return;
    }
    throw Error.createWriteProtected();
  }

  async getIo(name, options) {
    if (this.#fs) {
      return await this.#fs.getIo(name, options);
    }
    throw Error.createInvalidRequest();
  }

  async flush() {
    if (this.#fs) {
      return await this.#fs.flush();
    }
  }

  async close() {
    throw Error.createInvalidRequest();
  }

  async getAttributes() {
    return {
      encoding: 'UTF-2',
      volumeLabel: this.#name
    };
  }

  async getCwd() {
    if (this.#fs) {
      return '/' + this.#name + (await this.#fs.getAttributes()).volumeLabel +
        (await this.#fs.getCwd());
    }
    return '/' + this.#name;
  }
}