// vite.config.js | https://vitejs.dev/config/
import { defineConfig } from 'vite'
import fs from 'fs';
import path from 'path';

// Function to check for the presence of a command line argument
//const hasFlag = (flag) => process.argv.includes(flag);
const useHttps = process.env.HTTPS === '1';


// Configuration
export default defineConfig(() => {
  // Define server configuration
  const serverConfig = {
    port: 5173, // Default port
  };

  // If the https flag is present, set up HTTPS
  if (useHttps) {
    try {
      const pemList = fs.readdirSync(path.resolve(__dirname));
      const pemFiles = pemList.filter(file => file.endsWith('.pem') && !file.endsWith('-key.pem'));
      const keyPemFiles = pemList.filter(file => file.endsWith('-key.pem'));

      if (pemFiles.length > 0 && keyPemFiles.length > 0) {
        const certFile = pemFiles[0];
        const keyFile = keyPemFiles.find(file => file.replace('-key.pem', '.pem') === certFile);

        if (keyFile) {
          serverConfig.https = {
            key: fs.readFileSync(path.resolve(__dirname, keyFile)),
            cert: fs.readFileSync(path.resolve(__dirname, certFile)),
          };
        } else {
          throw new Error(`No matching key file found for the certificate file: ${certFile}`);
        }
      } else {
        throw new Error('No .pem files found for HTTPS configuration.');
      }
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }

  return {
    server: serverConfig,
    build: {
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          entryFileNames: `assets/js/[name].js`,
          chunkFileNames: `assets/js/[name].js`,
          assetFileNames: assetInfo => {
            if (/(\.png)|(\.gif)|(\.webp)|(\.ico)$/.test(assetInfo.name)) {
              return 'assets/images/[name].[ext]';
            }
            if (/(\.ttf)|(\.woff2)$/.test(assetInfo.name)) {
              return 'assets/fonts/[name].[ext]';
            }
            return 'assets/[name].[ext]';
          },
        },
      },
    },
  };
});
