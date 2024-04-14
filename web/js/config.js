async function saveConfig() {
	var logoUpload = document.getElementById('logoUpload');
    var logoFile = logoUpload.files[0];
    var logoBase64 = "";

    if (logoFile) {
        logoBase64 = await new Promise((resolve) => {
            var reader = new FileReader();
            reader.onloadend = function() {
                resolve(reader.result);
            }
            reader.readAsDataURL(logoFile);
        });
    }

	var config = {
		printerIP: document.getElementById('printerIP').value,
        logo: logoBase64,
		shopName: document.getElementById('shopName').value,
		phoneNumber: document.getElementById('phoneNumber').value,
		lineAccount: document.getElementById('lineAccount').value,
		qrText: document.getElementById('qrText').value,
		qrCodeType: document.querySelector('input[name="qrCode"]:checked').value, // This gets the value of the selected radio button
		qrCodeValue: document.getElementById('qrValue').value,
		thankYouMessage: document.getElementById('thankYouMessage').value
	};

	// Pass config to eel backend
	await eel.save_config(config)();

	refreshLogo();
}

async function loadConfig() {
	var config = await eel.load_config()();

	document.getElementById('printerIP').value = config.printerIP;
	document.getElementById('shopName').value = config.shopName;
	document.getElementById('phoneNumber').value = config.phoneNumber;
	document.getElementById('lineAccount').value = config.lineAccount;
	document.getElementById('qrText').value = config.qrText;
	document.querySelector(`input[name="qrCode"][value="${config.qrCodeType}"]`).checked = true; // This sets the selected radio button
	document.getElementById('qrValue').value = config.qrCodeValue;
	document.getElementById('thankYouMessage').value = config.thankYouMessage;
}

async function testPrint() {
	const spinnerWrapperEl = document.querySelector('.spinner-wrapper');

	try {
		spinnerWrapperEl.style.opacity = 0.5;
		spinnerWrapperEl.style.display = 'flex';
		var printerIP = document.getElementById('printerIP').value;
		var result = await eel.test_print(printerIP)();

		if (result !== "success") {
			showAlertModal(result);
		}
	} catch (e) {
		showAlertModal(e);
	} finally {
		spinnerWrapperEl.style.opacity = 0;

		setTimeout(() => {
			spinnerWrapperEl.style.display = 'none';			
		}, 200);
	}
}