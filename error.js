// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

export class Error {
  static createNotOpen() {
    return new Error(Error.notOpen);
  }
  static createInvalidBuffer() {
    return new Error(Error.invalidBuffer);
  }

  static unknown = 0;
  static notOpen = 1;
  static invalidBuffer = 2;

  #id = Error.unknown;

  constructor(id) {
    this.#id = id;
  }
}