# 元素徽记

7 个**原神（Genshin Impact）官方元素徽记**，文件名用游戏里的元素 key。
`assets/avatars/` 里没有对应角色头像时，棋盘/详情页会退回显示这些元素徽记。

## 文件清单

| key | 元素 | 文件名 | 素材名 | 来源 | HTTP | 尺寸 |
|---|---|---|---|---|---|---|
| `anemo` | 风 | `anemo.png` | `UI_Buff_Element_Wind` | Enka | 200 | 64×64, 2,769 B |
| `geo` | 岩 | `geo.png` | `UI_Buff_Element_Rock` | Enka | 200 | 64×64, 2,244 B |
| `electro` | 雷 | `electro.png` | `UI_Buff_Element_Electric` | Enka | 200 | 64×64, 2,117 B |
| `dendro` | 草 | `dendro.png` | `UI_Buff_Element_Grass` | Enka | 200 | 64×64, 2,164 B |
| `hydro` | 水 | `hydro.png` | `UI_Buff_Element_Water` | Enka | 200 | 64×64, 2,252 B |
| `pyro` | 火 | `pyro.png` | `UI_Buff_Element_Fire` | Enka | 200 | 64×64, 2,494 B |
| `cryo` | 冰 | `cryo.png` | `UI_Buff_Element_Ice` | **yatta** | 200 | 64×64, 2,679 B |

7/7 齐全，全部为 64×64 真 PNG（开头字节 `89 50 4E 47`），已逐张肉眼确认是对应元素的徽记。

## 来源与命名

元素徽记的**正确命名是 `UI_Buff_Element_*`**，不是 `UI_Icon_Element_*`
（后者试了 40+ 个变体全部 404）。元素名用的是游戏内部叫法，**不是英文元素名**：

| 元素 | ❌ 会 404 | ✅ 内部名 |
|---|---|---|
| 风 | `Anemo` | `Wind` |
| 岩 | `Geo` | `Rock` |
| 雷 | `Electro` | `Electric` |
| 草 | `Dendro` | `Grass` |
| 水 | `Hydro` | `Water` |
| 火 | `Pyro` | `Fire` |
| **冰** | `Cryo` | **`Ice`** |

### 冰元素 (`cryo.png`) 为什么来自另一个站

冰元素是唯一一个 **Enka.Network 没有镜像的文件**：

```
https://enka.network/ui/UI_Buff_Element_Ice.png   -> 404（名字没错，是站点缺这个文件）
https://gi.yatta.moe/assets/UI/UI_Buff_Element_Ice.png -> 200 ✓
```

**怎么确认 yatta 那份是同一个官方素材、不是仿的**：拿两个站都有的同名文件对 sha256，
结果**逐字节完全一致**——

| 文件 | Enka sha256(前16) | yatta sha256(前16) | 一致 |
|---|---|---|---|
| `UI_Buff_Element_Wind` | `2e13617eab4cac1b` | `2e13617eab4cac1b` | ✅ |
| `UI_Buff_Element_Fire` | `134405c2a26eec3b` | `134405c2a26eec3b` | ✅ |

同名文件在两站字节相同，说明 yatta 的 `/assets/UI/` 就是同一套官方素材的镜像，
因此 `cryo.png` 取自那里是可靠的。

### 备选源可达性（实测）

| 站点 | 结果 |
|---|---|
| `https://enka.network/ui/` | ✅ 200（缺 `UI_Buff_Element_Ice`） |
| `https://gi.yatta.moe/assets/UI/` | ✅ 200（7/7 齐全，元素图标与 Enka 字节一致） |
| `https://api.ambr.top/assets/UI/` | ❌ 网络不可达（`TypeError`，连不上） |
| `https://gi.yatta.moe/ui/` | ⚠️ 返回 200 但不是 PNG（是网页/JSON） |

> 注：`gi.yatta.moe` 的**角色头像**和 Enka 不同（分辨率不一样，`UI_AvatarIcon_Qin`
> 在 Enka 是 62,035 B / 256×256，在 yatta 是 26,607 B），所以头像仍以 Enka 为准；
> 只有**元素徽记**这两个站是字节一致的。

## `moon`（挪德卡莱）不在这里

游戏里还有一个非官方元素的 key `moon`（挪德卡莱），**本项目继续用 SVG 徽记，没有下载**，
所以本目录只有 7 个官方元素。需要的话再单独提。

## 版权说明

> **这些是原神（Genshin Impact）官方美术资源，版权归米哈游（miHoYo / HoYoverse）所有。**
>
> 本作 **《地产股神》是非商业同人作品**，不收费、不盈利、不带任何广告或内购。
> 使用这些徽记仅用于非商业性的同人娱乐与技术学习，属于合理使用范畴。
> **请勿二次分发这些素材、请勿用于任何商业用途。** 若版权方有异议，删除本目录下的
> 图片即可，游戏会自动退回使用内置 SVG 徽记，不影响运行。

## 使用说明

* 7 个都是 **64×64 透明底 PNG**，显示尺寸很小（棋盘上约 15px），清晰度足够。
* 圆形/任意裁切都不会出问题，图形本身居中且四周留白。

### ⚠️ 本目录目前**还没接进代码**（重要）

这个目录是新建的，**当前没有任何代码引用它**：

* `tools/build-single.mjs` 只内联 `assets/avatars/`，**不读 `assets/elements/`**；
* `src/ui.js` 里元素徽记是**写死在代码里的 SVG**，它只通过 `assets/avatars/<key>.png`
  读角色头像，没有读 `assets/elements/` 的路径；
* 全项目 grep `assets/elements` **零匹配**。

也就是说：**光把图放进来不会立刻生效**，还需要有人改代码把元素徽记从「内置 SVG」
切成读 `assets/elements/<key>.png`（源码版直读，单文件版要在 `build-single.mjs` 里
仿照 `AVATAR_DATA` 加一套 `ELEMENT_DATA` 内联）。这属于 `src/` 和 `tools/` 的改动，
不在素材任务的写入范围内，**这一步留给后续处理**。

图本身已按最终 key 命名好，接线时直接按 `<key>.png` 引用即可，无需再改名。
