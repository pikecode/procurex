#!/bin/bash
cd "$(dirname "$0")"
./start-local.sh
status=$?
if [ "$status" -ne 0 ]; then
  printf '\n启动失败，按回车关闭。\n'
  read -r
fi
exit "$status"
