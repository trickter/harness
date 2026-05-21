import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PermissionPolicy } from "../core/PermissionPolicy.js";

export class FileSystemAdapter {
  readonly permissions: PermissionPolicy;

  constructor(permissions: PermissionPolicy) {
    this.permissions = permissions;
  }

  async readText(path: string): Promise<string> {
    this.permissions.assertAllowed({ operation: "fs:read", artifacts: [path] });
    return readFile(path, "utf8");
  }

  async writeText(path: string, content: string): Promise<void> {
    this.permissions.assertAllowed({ operation: "fs:write", artifacts: [path] });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
}
