# Если нет прокси сервера
if [ ! "target/release" ]; then
  echo Need to build proxy server
  npm run proxy-build
  sleep 0.5s
fi

# Запускаем бота с прокси сервером
npm run run & npm run proxy