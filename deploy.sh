#!/bin/sh

rm -rf ./native
mkdir ./native
cd ./native
npm init -y
docker run -v "$PWD":/var/task -it lambci/lambda:build-nodejs6.10 npm install sharp
mv node_modules/sharp .
rm package.json
cd ..
serverless deploy