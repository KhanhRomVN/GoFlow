const path = require('path');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

const extensionConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    extensionAlias: {
      '.js': ['.ts', '.js'],
      '.cjs': ['.cts', '.cjs'],
      '.mjs': ['.mts', '.mjs']
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log",
  },
};

const webviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './src/webview/index.tsx',
  output: {
    path: path.resolve(__dirname, 'media'),
    filename: 'webview.js',
    globalObject: 'self',
    publicPath: ''
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      'path': false,
      'fs': false
    }
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }]
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.ttf$/,
        type: 'asset/resource',
        generator: {
          filename: 'fonts/[name][ext]'
        }
      }
    ]
  },
  plugins: [
    // Không cần MonacoWebpackPlugin nữa vì dùng pre-built version
  ],
  devtool: 'nosources-source-map',
  performance: {
    hints: false,
    maxEntrypointSize: 512000,
    maxAssetSize: 512000
  }
};

module.exports = [extensionConfig, webviewConfig];