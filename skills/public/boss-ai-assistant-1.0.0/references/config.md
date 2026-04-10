# Boss AI 助理配置说明

## 必需配置

### 阿里云百炼 API Key
用于 AI 对话生成。

获取地址：https://dashscope.console.aliyun.com/

### Google Custom Search API（可选）
用于搜索公司背景信息。

- API Key：从 Google Cloud Console 获取
- Search Engine ID：从 https://programmablesearchengine.google.com/ 创建

### Bark 推送（可选）
用于手机推送通知。

获取地址：https://api.day.app/

## 个人信息配置

在脚本中修改 `RESUME` 对象：

```javascript
const RESUME = {
    name: '姓名',
    title: '职位',
    phone: '手机号',
    email: '邮箱',
    location: '城市',
    experience: '经验年限',
    summary: '个人简介',
    skills: ['技能1', '技能2'],
    services: ['服务1', '服务2'],
    projects: ['项目1', '项目2'],
    techStack: '技术栈'
};
```

## 服务端配置（可选）

### 数据库
- 主机：localhost
- 数据库：hr
- 用户名/密码：自行配置

### PHP 文件
- `hr_api.php` - API 接口
- `hr_admin.php` - 管理后台
- `config.php` - 数据库配置

## 脚本安装

1. 复制 `scripts/boss_ai_assistant.js` 内容
2. ScriptCat/Tampermonkey 新建脚本
3. 粘贴并保存
4. 访问 Boss 直聘聊天页面测试