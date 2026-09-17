import assert from "node:assert/strict";
import { safeName } from "../src/util/paths.js";

assert.equal(safeName("Morning Grid"), "Morning-Grid");
assert.equal(safeName("../../bad"), "..-..-bad");

console.log("smoke tests passed");
