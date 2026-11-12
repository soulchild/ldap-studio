#!/bin/sh
# Creates a throwaway test CA and a server certificate for "localhost".
set -eu
dir="$(cd "$(dirname "$0")" && pwd)/certs"
if [ -f "$dir/server.crt" ]; then
  exit 0
fi
mkdir -p "$dir/dirsrv/ca"
cd "$dir"

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
  -subj "/CN=LDAP Studio Test CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -keyout ca.key -out ca.crt 2>/dev/null

openssl req -newkey rsa:2048 -nodes -sha256 -subj "/CN=localhost" \
  -keyout server.key -out server.csr 2>/dev/null
cat > server.ext <<EXT
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost
EXT
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 825 -sha256 -extfile server.ext -out server.crt 2>/dev/null
rm -f server.csr server.ext ca.srl

# 389-DS imports PEM files from /data/tls with this layout.
cp server.key server.crt dirsrv/
cp ca.crt dirsrv/ca/ca.crt
chmod 644 server.key dirsrv/server.key
echo "Created test certificates in $dir"
