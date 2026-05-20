# DS5 Dongle Manager

![ds5dongle-manager](https://socialify.git.ci/GooGuJiang/ds5dongle-manager/image?font=Inter&logo=https%3A%2F%2Fds5.g0v0.top%2Fpwa-icon.svg&name=1&pattern=Plus&theme=Light)

[English](README.md)

DS5 Dongle Manager 是一个为 [awalol/DS5Dongle](https://github.com/awalol/DS5Dongle) 制作的桌面端管理工具。

上游 DS5Dongle 项目可以将 Raspberry Pi Pico 2 W 变成 DualSense / DS5 手柄的无线适配器。本项目提供了一个图形化管理界面，用于更方便地连接设备、查看状态、修改配置并保存到设备中。

## 功能特性

- 自动发现并连接 DS5Dongle 设备
- 查看电量、固件版本、序列号和信号强度
- 读取、应用、保存和恢复设备配置
- 配置触觉反馈、扬声器音量、闲置断开、Pico 指示灯、回报率和控制器模式
- 支持 250 Hz、500 Hz、实时回报率，以及 DS5、DSE、自动模式
- 支持检测 Manager 更新，并从 GitHub 获取最新 DS5Dongle 固件版本进行提醒
- 支持浅色/深色/跟随系统主题、中英文界面和系统托盘查看手柄电量

## 项目截图

<table>
  <tr>
    <td align="center">
      <strong>主界面 - 浅色主题</strong><br />
      <img src="doc/images/main-white.webp" alt="主界面 - 浅色主题" width="100%" />
    </td>
    <td align="center">
      <strong>主界面 - 深色主题</strong><br />
      <img src="doc/images/main-black.webp" alt="主界面 - 深色主题" width="100%" />
    </td>
  </tr>
  <tr>
    <td align="center">
      <strong>设置界面 - 浅色主题</strong><br />
      <img src="doc/images/settings-white.webp" alt="设置界面 - 浅色主题" width="100%" />
    </td>
    <td align="center">
      <strong>设置界面 - 深色主题</strong><br />
      <img src="doc/images/settings-black.webp" alt="设置界面 - 深色主题" width="100%" />
    </td>
  </tr>
</table>

## License

MIT
