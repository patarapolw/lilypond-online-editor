FROM debian:11

# nodejs14
# Install nodejs 14
RUN apt-get update
RUN apt-get install -y lilypond
RUN apt-get install -y timidity
RUN apt-get install -y curl
RUN curl -sSL https://deb.nodesource.com/setup_14.x | bash -
RUN apt-get install -y nodejs gcc g++ make

RUN npm i -g yarn

WORKDIR /app
RUN mkdir tmp
COPY package.json yarn.lock ./
RUN yarn
COPY . .
RUN yarn build
RUN node -e 'const pkg = require("./package.json"); delete pkg.devDependencies; require("fs").writeFileSync("package.json", JSON.stringify(pkg))'
RUN yarn

COPY --from=ly-www /app/dist public

ENTRYPOINT [ "node", "." ]
