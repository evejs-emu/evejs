/**
 * EVE Python Representation Types
 *
 * Ported from PyRep.h/cpp in eve-common. These classes represent the Python
 * data types used in EVE's marshal protocol. The server uses these internally
 * to build and inspect structured data before marshaling it onto the wire.
 *
 * Unlike the C++ version, we don't need reference counting — JS has GC.
 */

// ─── Type Constants ─────────────────────────────────────────────────────────
const PyType = {
  NONE: "PyNone",
  INT: "PyInt",
  LONG: "PyLong",
  FLOAT: "PyFloat",
  BOOL: "PyBool",
  STRING: "PyString",
  WSTRING: "PyWString",
  TOKEN: "PyToken",
  BUFFER: "PyBuffer",
  TUPLE: "PyTuple",
  LIST: "PyList",
  DICT: "PyDict",
  OBJECT: "PyObject",
  OBJECT_EX: "PyObjectEx",
  SUBSTRUCT: "PySubStruct",
  SUBSTREAM: "PySubStream",
  CHECKSUMED: "PyChecksumedStream",
  PACKED_ROW: "PyPackedRow",
};

// ─── Base Class ─────────────────────────────────────────────────────────────

class PyRep {
  constructor(type) {
    this._type = type;
  }
  get type() {
    return this._type;
  }

  isNone() {
    return this._type === PyType.NONE;
  }
  isInt() {
    return this._type === PyType.INT;
  }
  isLong() {
    return this._type === PyType.LONG;
  }
  isFloat() {
    return this._type === PyType.FLOAT;
  }
  isBool() {
    return this._type === PyType.BOOL;
  }
  isString() {
    return this._type === PyType.STRING;
  }
  isWString() {
    return this._type === PyType.WSTRING;
  }
  isToken() {
    return this._type === PyType.TOKEN;
  }
  isBuffer() {
    return this._type === PyType.BUFFER;
  }
  isTuple() {
    return this._type === PyType.TUPLE;
  }
  isList() {
    return this._type === PyType.LIST;
  }
  isDict() {
    return this._type === PyType.DICT;
  }
  isObject() {
    return this._type === PyType.OBJECT;
  }
  isObjectEx() {
    return this._type === PyType.OBJECT_EX;
  }
  isSubStruct() {
    return this._type === PyType.SUBSTRUCT;
  }
  isSubStream() {
    return this._type === PyType.SUBSTREAM;
  }

  clone() {
    throw new Error(`clone() not implemented for ${this._type}`);
  }

  /** Dump to a readable string for debug logging */
  dump(indent = "") {
    return `${indent}${this._type}`;
  }
}

// ─── Concrete Types ─────────────────────────────────────────────────────────

class PyNone extends PyRep {
  constructor() {
    super(PyType.NONE);
  }
  clone() {
    return new PyNone();
  }
  dump(indent = "") {
    return `${indent}None`;
  }
}

class PyInt extends PyRep {
  constructor(value = 0) {
    super(PyType.INT);
    this._value = value | 0; // force int32
  }
  get value() {
    return this._value;
  }
  clone() {
    return new PyInt(this._value);
  }
  dump(indent = "") {
    return `${indent}Int(${this._value})`;
  }
}

class PyLong extends PyRep {
  constructor(value = 0n) {
    super(PyType.LONG);
    this._value = typeof value === "bigint" ? value : BigInt(value);
  }
  get value() {
    return this._value;
  }
  clone() {
    return new PyLong(this._value);
  }
  dump(indent = "") {
    return `${indent}Long(${this._value})`;
  }
}

class PyFloat extends PyRep {
  constructor(value = 0.0) {
    super(PyType.FLOAT);
    this._value = value;
  }
  get value() {
    return this._value;
  }
  clone() {
    return new PyFloat(this._value);
  }
  dump(indent = "") {
    return `${indent}Float(${this._value})`;
  }
}

class PyBool extends PyRep {
  constructor(value = false) {
    super(PyType.BOOL);
    this._value = !!value;
  }
  get value() {
    return this._value;
  }
  clone() {
    return new PyBool(this._value);
  }
  dump(indent = "") {
    return `${indent}Bool(${this._value})`;
  }
}

class PyString extends PyRep {
  constructor(value = "") {
    super(PyType.STRING);
    this._value =
      typeof value === "string"
        ? value
        : Buffer.isBuffer(value)
          ? value.toString("utf8")
          : String(value);
  }
  get value() {
    return this._value;
  }
  get content() {
    return this._value;
  }
  get length() {
    return this._value.length;
  }
  clone() {
    return new PyString(this._value);
  }
  dump(indent = "") {
    return `${indent}String("${this._value}")`;
  }
}

class PyWString extends PyRep {
  constructor(value = "") {
    super(PyType.WSTRING);
    this._value = typeof value === "string" ? value : String(value);
  }
  get value() {
    return this._value;
  }
  get content() {
    return this._value;
  }
  get length() {
    return this._value.length;
  }
  clone() {
    return new PyWString(this._value);
  }
  dump(indent = "") {
    return `${indent}WString("${this._value}")`;
  }
}

class PyToken extends PyRep {
  constructor(value = "") {
    super(PyType.TOKEN);
    this._value = typeof value === "string" ? value : String(value);
  }
  get value() {
    return this._value;
  }
  get content() {
    return this._value;
  }
  clone() {
    return new PyToken(this._value);
  }
  dump(indent = "") {
    return `${indent}Token("${this._value}")`;
  }
}

class PyBuffer extends PyRep {
  constructor(data = Buffer.alloc(0)) {
    super(PyType.BUFFER);
    this._data = Buffer.isBuffer(data) ? data : Buffer.from(data);
  }
  get content() {
    return this._data;
  }
  get length() {
    return this._data.length;
  }
  clone() {
    return new PyBuffer(Buffer.from(this._data));
  }
  dump(indent = "") {
    return `${indent}Buffer(${this._data.length} bytes: ${this._data.toString("hex").substring(0, 40)}...)`;
  }
}

class PyTuple extends PyRep {
  constructor(size = 0) {
    super(PyType.TUPLE);
    this._items = new Array(size).fill(null);
  }
  get size() {
    return this._items.length;
  }
  get items() {
    return this._items;
  }
  getItem(i) {
    return this._items[i];
  }
  setItem(i, val) {
    this._items[i] = val;
  }
  addItem(val) {
    this._items.push(val);
  }

  clone() {
    const t = new PyTuple(this._items.length);
    for (let i = 0; i < this._items.length; i++) {
      t._items[i] = this._items[i] ? this._items[i].clone() : null;
    }
    return t;
  }
  dump(indent = "") {
    const inner = this._items
      .map((it, i) => `${indent}  [${i}] ${it ? it.dump() : "null"}`)
      .join("\n");
    return `${indent}Tuple(${this._items.length}):\n${inner}`;
  }
}

class PyList extends PyRep {
  constructor(size = 0) {
    super(PyType.LIST);
    this._items = new Array(size).fill(null);
  }
  get size() {
    return this._items.length;
  }
  get items() {
    return this._items;
  }
  getItem(i) {
    return this._items[i];
  }
  setItem(i, val) {
    this._items[i] = val;
  }
  addItem(val) {
    this._items.push(val);
  }

  clone() {
    const l = new PyList(this._items.length);
    for (let i = 0; i < this._items.length; i++) {
      l._items[i] = this._items[i] ? this._items[i].clone() : null;
    }
    return l;
  }
  dump(indent = "") {
    const inner = this._items
      .map((it, i) => `${indent}  [${i}] ${it ? it.dump() : "null"}`)
      .join("\n");
    return `${indent}List(${this._items.length}):\n${inner}`;
  }
}

class PyDict extends PyRep {
  constructor() {
    super(PyType.DICT);
    this._entries = []; // Array of { key: PyRep, value: PyRep }
  }
  get size() {
    return this._entries.length;
  }
  get entries() {
    return this._entries;
  }

  setItem(key, value) {
    // Check if key already exists
    for (const entry of this._entries) {
      if (
        entry.key instanceof PyString &&
        key instanceof PyString &&
        entry.key.value === key.value
      ) {
        entry.value = value;
        return;
      }
      if (
        entry.key instanceof PyInt &&
        key instanceof PyInt &&
        entry.key.value === key.value
      ) {
        entry.value = value;
        return;
      }
    }
    this._entries.push({ key, value });
  }

  getItem(key) {
    const keyStr =
      key instanceof PyString
        ? key.value
        : key instanceof PyRep
          ? null
          : String(key);
    for (const entry of this._entries) {
      if (
        keyStr !== null &&
        entry.key instanceof PyString &&
        entry.key.value === keyStr
      ) {
        return entry.value;
      }
    }
    return null;
  }

  /** Get value by string key name (convenience) */
  getByName(name) {
    for (const entry of this._entries) {
      if (entry.key instanceof PyString && entry.key.value === name)
        return entry.value;
      if (entry.key instanceof PyWString && entry.key.value === name)
        return entry.value;
    }
    return null;
  }

  clone() {
    const d = new PyDict();
    for (const entry of this._entries) {
      d._entries.push({
        key: entry.key ? entry.key.clone() : null,
        value: entry.value ? entry.value.clone() : null,
      });
    }
    return d;
  }
  dump(indent = "") {
    const inner = this._entries
      .map(
        (e) =>
          `${indent}  ${e.key ? e.key.dump() : "null"} => ${e.value ? e.value.dump() : "null"}`,
      )
      .join("\n");
    return `${indent}Dict(${this._entries.length}):\n${inner}`;
  }
}

class PyObject extends PyRep {
  constructor(typeName, args) {
    super(PyType.OBJECT);
    this._typeName =
      typeName instanceof PyString ? typeName : new PyString(typeName || "");
    this._args = args || new PyNone();
  }
  get typeName() {
    return this._typeName;
  }
  get args() {
    return this._args;
  }
  clone() {
    return new PyObject(this._typeName.clone(), this._args.clone());
  }
  dump(indent = "") {
    return `${indent}Object("${this._typeName.value}"):\n${indent}  ${this._args.dump()}`;
  }
}

class PyObjectEx extends PyRep {
  constructor(isType2 = false, header = null) {
    super(PyType.OBJECT_EX);
    this._isType2 = isType2;
    this._header = header || new PyNone();
    this._list = new PyList();
    this._dict = new PyDict();
  }
  get isType2() {
    return this._isType2;
  }
  get header() {
    return this._header;
  }
  get list() {
    return this._list;
  }
  get dict() {
    return this._dict;
  }
  clone() {
    const o = new PyObjectEx(this._isType2, this._header.clone());
    o._list = this._list.clone();
    o._dict = this._dict.clone();
    return o;
  }
  dump(indent = "") {
    return (
      `${indent}ObjectEx(type2=${this._isType2}):\n` +
      `${indent}  header: ${this._header.dump()}\n` +
      `${indent}  list: ${this._list.dump()}\n` +
      `${indent}  dict: ${this._dict.dump()}`
    );
  }
}

class PySubStruct extends PyRep {
  constructor(sub = null) {
    super(PyType.SUBSTRUCT);
    this._sub = sub || new PyNone();
  }
  get sub() {
    return this._sub;
  }
  clone() {
    return new PySubStruct(this._sub.clone());
  }
  dump(indent = "") {
    return `${indent}SubStruct:\n${indent}  ${this._sub.dump()}`;
  }
}

class PySubStream extends PyRep {
  constructor(data = null, decoded = null) {
    super(PyType.SUBSTREAM);
    this._data = data; // PyBuffer or null
    this._decoded = decoded; // PyRep or null
  }
  get data() {
    return this._data;
  }
  get decoded() {
    return this._decoded;
  }
  clone() {
    return new PySubStream(
      this._data ? this._data.clone() : null,
      this._decoded ? this._decoded.clone() : null,
    );
  }
  dump(indent = "") {
    if (this._decoded) {
      return `${indent}SubStream (decoded):\n${indent}  ${this._decoded.dump()}`;
    }
    return `${indent}SubStream (raw ${this._data ? this._data.length : 0} bytes)`;
  }
}

class PyChecksumedStream extends PyRep {
  constructor(data = null, checksum = 0) {
    super(PyType.CHECKSUMED);
    this._data = data;
    this._checksum = checksum;
  }
  get data() {
    return this._data;
  }
  get checksum() {
    return this._checksum;
  }
  clone() {
    return new PyChecksumedStream(
      this._data ? this._data.clone() : null,
      this._checksum,
    );
  }
  dump(indent = "") {
    return (
      `${indent}ChecksumedStream(sum=0x${this._checksum.toString(16)}):\n` +
      `${indent}  ${this._data ? this._data.dump() : "null"}`
    );
  }
}

module.exports = {
  PyType,
  PyRep,
  PyNone,
  PyInt,
  PyLong,
  PyFloat,
  PyBool,
  PyString,
  PyWString,
  PyToken,
  PyBuffer,
  PyTuple,
  PyList,
  PyDict,
  PyObject,
  PyObjectEx,
  PySubStruct,
  PySubStream,
  PyChecksumedStream,
};
