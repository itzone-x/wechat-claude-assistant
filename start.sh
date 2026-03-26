#!/bin/bash
# 微信和 Claude 手牵手 - 快速启动脚本

echo "启动微信和 Claude 手牵手..."
echo ""

cd "$(dirname "$0")"

# 检查是否已编译
if [ ! -d "dist" ]; then
    echo "首次运行，正在编译..."
    npm run build
fi

echo "推荐先运行安装向导："
echo "  node dist/cli.js install"
echo ""
echo "如果已经完成安装，默认启动 worker 模式："
echo "  node dist/cli.js start"
echo ""
echo "如果你满足 Claude Channels 条件，并且明确要桥接当前会话，再使用高级 channels 模式："
echo "  node dist/cli.js start --mode channels"
