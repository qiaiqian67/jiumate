# 拒绝越出自身目录的 Petdex 包，并修复目录导入与目录数量上限

- **Date:** 2026-09-18
- **Type:** fix
- **Scope:** `pets`, `server`, `web`

[English](2026-09-18-fix-pet-package-path-escape-and-import.md)

修复了 Petdex 宠物包层面的三个缺陷：manifest 可以指向自身包目录之外的文件、从设置页导入文件夹必定失败，以及包数量上限会把整个目录报告为空。

## 精灵图路径不再能越出所在包

- `coercePetPackage` 只在 `spritesheetPath` 的首尾拒绝 `..`，因此把穿越放在中间（`a/../../../etc/passwd`）就能通过全部检查，随后 `join` 会把它解析到包目录之外。`POST /api/pets/import` 会读取该文件并把它的字节装成该宠物的精灵图，`GET /api/pets/:slug/spritesheet` 再把它发出去。
- 现在路径的每一段只要等于 `.`、`..` 或为空就会被拒绝，无论出现在哪里。
- 同时校验解析后的结果：在保存之前确认精灵图的绝对路径位于解析后的包目录之内，这也能覆盖 Windows 主机自行归一化的段形式。

## 从设置页导入文件夹恢复正常

- 用户选择目录时，web 端选择器会发送 `expectedFingerprint: null`，而该路由对任何非字符串值都以 `400 invalid_pet_import` 拒绝，导致「设置 → 应用」里的每一次导入都失败。
- 现在没有可校验对象时，选择器不再发送该字段；路由也把显式的 `null` 与字段缺失视为同一含义。

## 包数量上限不再清空目录

- 当 pets 目录中的条目超过 `MAX_PACKAGES` 时，`readPetCatalog` 会抛错，而 `PetCatalogService.list` 会把读取失败报告为零个宠物。该目录是按全部条目计数而非按宠物目录计数，因此几个无关文件就足以让所有已安装宠物从选择器里消失。
- 现在读取只统计目录，并在达到上限时截断，而不是抛错。
- `ensureRoom` 改为直接从文件系统读取已安装目录数量，不再依赖 `list()`，因此导入上限的判断不再取决于目录读取是否成功。

## 测试

- `packages/pets` 覆盖了路径中段的穿越、仍然合法的嵌套相对路径、pets 根目录中混入无关文件，以及目录数量超过上限的情形。
- `packages/server` 覆盖了导入请求体携带显式 `null` 指纹的情形。
- `packages/web` 覆盖了携带与不携带已校验指纹时的导入请求体。
