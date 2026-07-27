# AIHub Desktop

客户端快速模板的字段来源与安全约束见 [CONFIG_SOURCES.md](CONFIG_SOURCES.md)。

面向 `https://aihub.top` 普通用户的 Windows 桌面工作台。

## 功能

- 邮箱密码登录、JWT 自动刷新和当前会话退出
- Windows 本机加密保存 refresh token，密码不落盘
- 可选记住登录邮箱，密码始终不落盘
- 余额、今日消费、Token、Key 和消费趋势总览
- API Key 创建、复制、启停和删除
- API Key 最大倍率与故障转移策略由 AIHub 官方 `/api/v1/keys` 接口保存并执行
- 调用明细与周期统计
- 独立调用日志、组合筛选、详情与 CSV 导出
- 供应商大厅、分组倍率、首 Token、TPS、多窗口可用率与趋势曲线
- 客户端配置工作区，覆盖 codex、codex (WebSocket) 和 OpenCode
- 启动和进入配置页时静默同步现有配置，并重新检测客户端安装目录
- 配置档切换前自动备份，写入失败自动回滚，并支持历史备份恢复
- 圆角信息气泡与可滚动长列表
- 订阅、订单、兑换码和邀请返利
- 个人资料、密码和全设备会话撤销
- 使用教程、开源致谢与 Windows 系统托盘

应用只允许普通用户接口，主进程会拒绝 `/admin` 和白名单外的路径。模型调用 Key 与账户 JWT 相互独立，模型 Key 不能用于管理账户。

## 开发运行

开发环境位于移动盘时，请使用绝对 Node 路径：

```powershell
$env:Path = 'D:\nodejs;' + $env:Path
& 'D:\nodejs\npm.cmd' install
& 'D:\nodejs\npm.cmd' start
```

实际盘符变化时应相应替换 `D:`。

## 生成免安装版

```powershell
$env:Path = 'D:\nodejs;' + $env:Path
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
& 'D:\nodejs\npm.cmd' run dist
```

输出文件：`dist/AIHub-Desktop-1.0.6.exe`。
