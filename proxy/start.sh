# Если нет прокси сервера
if [ ! "target/release" ]; then
  echo Need to build proxy server
  cargo build --release
  sleep 0.5s
fi

cd target/release
./sthp -p 8080 -s 127.0.0.1:1080