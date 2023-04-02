// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

export class Error {
  static dumpCallStack(message) {
    const e = new window.Error();
    console.log(message, e.stack);
  }

  static createNotOpen(hint, self) {
    return new Error(Error.notOpen, hint, self);
  }
  static createInvalidBuffer(hint, self) {
    return new Error(Error.invalidBuffer, hint, self);
  }
  static createInvalidRequest(hint, self) {
    return new Error(Error.invalidRequest, hint, self);
  }
  static createInvalidFormat(hint, self) {
    return new Error(Error.invalidFormat, hint, self);
  }
  static createNotImplemented(hint, self) {
    return new Error(Error.notImplemented, hint, self);
  }
  static createNotFound(hint, self) {
    return new Error(Error.notFound, hint, self);
  }
  static createNoSpace(hint, self) {
    return new Error(Error.noSpace, hint, self);
  }
  static createInvalidName(hint, self) {
    return new Error(Error.invalidName, hint, self);
  }
  static createNotEmpty(hint, self) {
    return new Error(Error.notEmpty, hint, self);
  }
  static createDiskError(hint, self) {
    return new Error(Error.diskError, hint, self);
  }
  static createWriteProtected(hint, self) {
    return new Error(Error.writeProtected, hint, self);
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
  static diskError = 9;
  static writeProtected = 10;

  id = Error.unknown;
  stack = null;
  #hint = '';
  #self = null;

  constructor(id, hint, self) {
    this.id = id;
    if (hint) {
      this.#hint = hint;
    }
    if (self) {
      this.#self = self;
    }
    this.stack = (new window.Error()).stack;
  }
}