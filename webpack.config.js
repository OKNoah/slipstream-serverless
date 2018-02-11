const path = require('path')
const slsw = require('serverless-webpack')
const nodeExternals = require('webpack-node-externals')
const CopyWebpackPlugin = require('copy-webpack-plugin')

module.exports = {
  entry: slsw.lib.entries,
  resolve: {
    extensions: ['.js', '.json']
  },
  target: 'node',
  module: {
    rules: [{
      test: /\.js$/,
      loader: "babel-loader",
      include: __dirname,
      exclude: /node_modules/
    }]
  },
  output: {
    libraryTarget: 'commonjs',
    path: path.join(__dirname, '.webpack'),
    filename: '[name].js'
  },
  externals: [
    nodeExternals(),
    function(context, request, callback) {
      if (/native/.test(request)) {
        return callback(null, true)
      }
      callback()
    }
  ],
  plugins: [
    new CopyWebpackPlugin([{ from: 'native/sharp', to: 'native/sharp' }])
  ]
}
