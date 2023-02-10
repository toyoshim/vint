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
  static createInvalidRequest() {
    return new Error(Error.invalidRequest);
  }
  static createInvalidFormat() {
    return new Error(Error.invalidFormat);
  }

  static unknown = 0;
  static notOpen = 1;
  static invalidBuffer = 2;
  static invalidRequest = 3;
  static invalidFormat = 4;

  #id = Error.unknown;

  constructor(id) {
    this.#id = id;
  }
}