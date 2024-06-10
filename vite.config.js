// vite.config.js | https://vitejs.dev/config/
import { defineConfig } from 'vite'
import fs from 'fs';
import path from 'path';
import { networkInterfaces } from 'os';

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
      // get local IPs in the same way Vite does, and use mkcert to generate a certificate for all addresses
      const interfaces = networkInterfaces();
      let localIp = 'localhost';
      let ipLevel=4, preferredIp='';
      for (const key in interfaces) {
        for (const details of interfaces[key]) {
          if (details.family === 'IPv4' && !details.internal) {
              switch (details.address.split('.')[0]) {
                case '192':
                  if (ipLevel>1) {
                    preferredIp=details.address
                    ipLevel=1
                  }
                  if (details.address!="192.168.137.1" && ipLevel>=1) {
                    preferredIp=details.address // prefer anything other than windows hotspot
                  }
                  break;
                case '172':
                  if (ipLevel>2) {
                    preferredIp=details.address
                    ipLevel=2
                  }
                  break;
                case '10':
                  if (ipLevel>3) {
                    preferredIp=details.address
                    ipLevel=3
                  }
                  break;
                default:
                  break;
              }
              localIp += " " + details.address;
          }
        }
      }
      
      console.log("localIP Addresses: " + localIp);


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
        console.error('No .pem files found for HTTPS configuration.');
        console.log('Please generate a certificate and key file using mkcert:');
        console.log('mkcert ' + (preferredIp ? preferredIp + " " + localIp.replace(" "+preferredIp,"") : localIp));
        throw new Error('No .pem files found for HTTPS configuration.');
      }
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  } else {
    console.log('HTTPS is not enabled. To enable it, run the dev server with the HTTPS environment variable set to 1:');
    console.log('HTTPS=1 npx vite --host -d    or   HTTPS=1 npm run dev   or powershell  $env:HTTPS=1; npx vite --host -d');
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
