// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

export class Error {
  static createNotOpen(hint) {
    return new Error(Error.notOpen, hint);
  }
  static createInvalidBuffer(hint) {
    return new Error(Error.invalidBuffer, hint);
  }
  static createInvalidRequest(hint) {
    return new Error(Error.invalidRequest, hint);
  }
  static createInvalidFormat(hint) {
    return new Error(Error.invalidFormat, hint);
  }
  static createNotImplemented(hint) {
    return new Error(Error.notImplemented, hint);
  }
  static createNotFound(hint) {
    return new Error(Error.notFound, hint);
  }
  static createNoSpace(hint) {
    return new Error(Error.noSpace, hint);
  }
  static createInvalidName(hint) {
    return new Error(Error.invalidName, hint);
  }
  static createNotEmpty(hint) {
    return new Error(Error.notEmpty, hint);
  }

  static notImplemented = -1;
  static unknown = 0;
  static notOpen = 1;
  static invalidBuffer = 2;
  static invalidRequest = 3;
  static invalidFormat = 4;
  static notFound = 5;
  static noSpace = 6;
  static invalidName = 7;
  static notEmpty = 8;

  #id = Error.unknown;
  #hint = '';

  constructor(id, hint) {
    this.#id = id;
    if (hint) {
      this.#hint = hint;
    }
  }
}