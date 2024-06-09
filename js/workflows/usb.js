import {CONNTYPE, CONNSTATE} from '../constants.js';
import {Workflow} from './workflow.js';
import {GenericModal} from '../common/dialogs.js';
import {FileTransferClient} from '../common/usb-file-transfer.js';
import {
    serial as polyfill, SerialPort as SerialPortPolyfill,
  } from 'web-serial-polyfill';

let btnRequestSerialDevice, btnSelectHostFolder, btnUseHostFolder, lblWorkingfolder;
let ourSerial = navigator.serial || polyfill;
let SerialPort = SerialPort || SerialPortPolyfill;

class USBWorkflow extends Workflow {
    constructor() {
        super();
        this._serialDevice = null;
        this.titleMode = false;
        this.reader = null;
        this.writer = null;
        this.connectDialog = new GenericModal("usb-connect");
        this._fileContents = null;
        this.type = CONNTYPE.Usb;
        this._partialToken = null;
        this._uid = null;
        this._readLoopPromise = null;
    }

    async init(params) {
        await super.init(params);
    }

    // This is called when a user clicks the main disconnect button
    async disconnectButtonHandler(e) {
        await super.disconnectButtonHandler(e);
        if (this.connectionStatus()) {
            await this.onDisconnected(null, false);
        }
    }

    async onConnected(e) {
        this.connectDialog.close();
        await this.loadEditor();
        super.onConnected(e);
    }

    async onDisconnected(e, reconnect = true) {
        if (this.reader) {
            await this.reader.cancel();
            this.reader = null;
        }
        if (this.writer) {
            await this.writer.releaseLock();
            this.writer = null;
        }

        if (this._serialDevice) {
            await this._serialDevice.close();
            this._serialDevice = null;
        }

        super.onDisconnected(e, reconnect);
    }

    async serialTransmit(msg) {
        const encoder = new TextEncoder();
        if (this.writer) {
            const encMessage = encoder.encode(msg);
            await this.writer.ready.catch((err) => {
                console.error(`Ready error: ${err}`);
            });
            await this.writer.write(encMessage).catch((err) => {
                console.error(`Chunk error: ${err}`);
            });
            await this.writer.ready;
        }
    }

    async connect() {
        let result;
        if (result = await super.connect() instanceof Error) {
            return result;
        }

        return await this.connectToDevice();
    }

    async connectToDevice() {
        return await this.connectToSerial();
    }

    async connectToSerial() {
        // There's no way to reference a specific port, so we just hope the user
        // only has a single device stored and connected. However, we can check that
        // the device on the stored port is currently connected by checking if the
        // readable and writable properties are null.

        let allDevices = await ourSerial.getPorts();
        let connectedDevices = [];
        for (let device of allDevices) {
            let devInfo = await device.getInfo();
            if (devInfo.readable && devInfo.writable) {
                connectedDevices.push(device);
            }
        }
        let device = null;

        if (connectedDevices.length == 1) {
            device = connectedDevices[0];
            console.log(await device.getInfo());
            try {
                // Attempt to connect to the saved device. If it's not found, this will fail.
                await this._switchToDevice(device);
            } catch (e) {
                // We should probably remove existing devices if it fails here
                await device.forget();

                console.log("Failed to automatically connect to saved device. Prompting user to select a device.");
                device = await ourSerial.requestPort();
                console.log(device);
            }

            // TODO: Make it more obvious to user that something happened for smaller screens
            // Perhaps providing checkmarks by adding a css class when a step is complete would be helpful
            // This would help with other workflows as well
        } else {
            console.log('Requesting any serial device...');
            device = await ourSerial.requestPort();
        }

        // If we didn't automatically use a saved device
        if (!this._serialDevice) {
            console.log('> Requested ', device);
            await this._switchToDevice(device);
        }
        console.log(this._serialDevice);
        if (this._serialDevice != null) {
            this._connectionStep(2);
            return true;
        }

        return false;
    }

    async showConnect(documentState) {
        let p = this.connectDialog.open();
        let modal = this.connectDialog.getModal();

        btnRequestSerialDevice = modal.querySelector('#requestSerialDevice');
        btnSelectHostFolder = modal.querySelector('#selectHostFolder');
        btnUseHostFolder = modal.querySelector('#useHostFolder');
        lblWorkingfolder = modal.querySelector('#workingFolder');

        btnRequestSerialDevice.disabled = true;
        btnSelectHostFolder.disabled = true;

        btnRequestSerialDevice.addEventListener('click', async (event) => {
            try {
                await this.connectToSerial();
            } catch (e) {
                //console.log(e);
                //alert(e.message);
                //alert("Unable to connect to device. Make sure it is not already in use.");
                // TODO: I think this also occurs if the user cancels the requestPort dialog
            }
        });

        btnSelectHostFolder.addEventListener('click', async (event) => {
            await this._selectHostFolder();
        });

        btnUseHostFolder.addEventListener('click', async (event) => {
            await this._useHostFolder();
        });

        if (!(await this.available() instanceof Error)) {
            let stepOne;
            if (stepOne = modal.querySelector('.step:first-of-type')) {
                stepOne.classList.add("hidden");
            }
            this._connectionStep(1);
        } else {
            modal.querySelectorAll('.step:not(:first-of-type)').forEach((stepItem) => {
                stepItem.classList.add("hidden");
            });
            this._connectionStep(0);
        }

        // TODO: If this is closed before all steps are completed, we should close the serial connection
        // probably by calling onDisconnect()

        return await p;
    }

    async available() {
        if (!('serial' in navigator)) {
            return Error("Web Serial is not enabled in this browser");
        }
        return true;
    }

    // Workflow specific functions
    async _selectHostFolder() {
        console.log('Initializing File Transfer Client...');
        const fileClient = this.fileHelper.getFileClient();
        const changed = await fileClient.loadDirHandle(false);
        if (changed) {
            await this._hostFolderChanged();
        }
    }

    async _useHostFolder() {
        await this.fileHelper.listDir('/');
        this.onConnected();
    }

    async _hostFolderChanged() {
        const fileClient = this.fileHelper.getFileClient();
        const folderName = fileClient.getWorkingDirectoryName();
        console.log("New folder name:", folderName);
        if (folderName) {
            // Set the working folder label
            lblWorkingfolder.innerHTML = folderName;
            btnUseHostFolder.classList.remove("hidden");
            btnSelectHostFolder.innerHTML = "Select Different Folder";
            btnSelectHostFolder.classList.add("inverted");
            btnSelectHostFolder.classList.remove("first-item");
        }
    }

    async _switchToDevice(device) {
        device.addEventListener("message", this.onSerialReceive.bind(this));

        this._serialDevice = device;
        console.log("switch to", this._serialDevice);
        await this._serialDevice.open({baudRate: 115200}); // TODO: Will fail if something else is already connected or it isn't found.

        // Start the read loop
        this._readLoopPromise = this._readSerialLoop().catch(
            async function(error) {
                await this.onDisconnected();
            }.bind(this)
        );

        if (this._serialDevice.writable) {
            this.writer = this._serialDevice.writable.getWriter();
            await this.writer.ready;
        }

        await this.showBusy(this._getDeviceUid());

        this.updateConnected(CONNSTATE.partial);

        // At this point we should see if we should init the file client and check if have a saved dir handle
        this.initFileClient(new FileTransferClient(this.connectionStatus.bind(this), this._uid));
        const fileClient = this.fileHelper.getFileClient();
        const result = await fileClient.loadSavedDirHandle();
        if (result) {
            console.log("Successfully loaded directory:", fileClient.getWorkingDirectoryName());
            await this._hostFolderChanged();
        } else {
            console.log("Failed to load directory");
        }
    }

    async _getDeviceUid() {
        // TODO: Make this python code more robust for older devices
        // For instance what if there is an import error with binascii
        // or uid is not set due to older firmware
        // or microcontroller is a list
        // It might be better to take a minimal python approach and do most of
        // the conversion in the javascript code

        console.log("Getting Device UID...");
        let result = await this.repl.runCode(
`import microcontroller
import binascii
binascii.hexlify(microcontroller.cpu.uid).decode('ascii').upper()`
        );
        // Strip out whitespace as well as start and end quotes
        if (result) {
            this._uid = result.trim().slice(1, -1);
            console.log("Device UID: " + this._uid);
            this.debugLog("Device UID: " + this._uid)
        } else {
            console.log("Failed to get Device UID, result was", result);
        }
    }

    async _readSerialLoop() {
        console.log("Read Loop Init");
        if (!this._serialDevice) {
            return;
        }

        const messageEvent = new Event("message");
        const decoder = new TextDecoder();

        if (this._serialDevice.readable) {
            this.reader = this._serialDevice.readable.getReader();
            console.log("Read Loop Started");
            while (true) {
                const {value, done} = await this.reader.read();
                if (value) {
                    messageEvent.data = decoder.decode(value);
                    this._serialDevice.dispatchEvent(messageEvent);
                }
                if (done) {
                    this.reader.releaseLock();
                    break;
                }
            }
        }

        console.log("Read Loop Stopped. Closing Serial Port.");
    }

    // Handle the different button states for various connection steps
    _connectionStep(step) {
        const buttonStates = [
            {request: false, select: false},
            {request: true, select: false},
            {request: true, select: true},
        ];

        if (step < 0) step = 0;
        if (step > buttonStates.length - 1) step = buttonStates.length - 1;

        btnRequestSerialDevice.disabled = !buttonStates[step].request;
        btnSelectHostFolder.disabled = !buttonStates[step].select;
    }
}

export {USBWorkflow};
