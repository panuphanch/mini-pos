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

	var sheetsCredsFile = document.getElementById('sheetsCreds').files[0];
    var sheetsCredsBlob = await new Promise((resolve) => {
        var reader = new FileReader();
        reader.onloadend = function() {
            resolve(reader.result);
        }
        reader.readAsDataURL(sheetsCredsFile);
    });

	var config = {
		printerIP: document.getElementById('printerIP').value,
		shopName: document.getElementById('shopName').value,
		shopPhone: document.getElementById('shopPhone').value,
		shopLine: document.getElementById('shopLine').value,
		qrText: document.getElementById('qrText').value,
		qrCodeType: document.querySelector('input[name="qrCode"]:checked').value, // This gets the value of the selected radio button
		qrCodeValue: document.getElementById('qrValue').value,
		thankYouMessage: document.getElementById('thankYouMessage').value,
        logo: logoBase64,
		sheetName: document.getElementById('sheetName').value,
        sheetsCreds: sheetsCredsBlob
	};

	// Pass config to eel backend
	var result = await eel.save_config(config)();

	refreshLogo();

	showAlertModal(result);
}

async function loadConfig() {
	var config = await eel.load_config()();

	document.getElementById('printerIP').value = config.printerIP;
	document.getElementById('shopName').value = config.shopName;
	document.getElementById('shopPhone').value = config.shopPhone;
	document.getElementById('shopLine').value = config.shopLine;
	document.getElementById('qrText').value = config.qrText;
	document.querySelector(`input[name="qrCode"][value="${config.qrCodeType}"]`).checked = true; // This sets the selected radio button
	document.getElementById('qrValue').value = config.qrCodeValue;
	document.getElementById('thankYouMessage').value = config.thankYouMessage;
	document.getElementById('sheetName').value = config.sheetName;
}

async function testPrint() {
	const spinnerWrapperEl = document.querySelector('.spinner-wrapper');

	try {
		spinnerWrapperEl.style.opacity = 0.5;
		spinnerWrapperEl.style.display = 'flex';
		var printerIP = document.getElementById('printerIP').value;
		var result = await eel.test_print(printerIP)();

		showAlertModal(result);
	} catch (e) {
		showAlertModal(e);
	} finally {
		spinnerWrapperEl.style.opacity = 0;

		setTimeout(() => {
			spinnerWrapperEl.style.display = 'none';			
		}, 200);
	}
}

async function testSheetConnection() {
	const spinnerWrapperEl = document.querySelector('.spinner-wrapper');
	const sheetName = document.getElementById('sheetName').value;

	try {
		spinnerWrapperEl.style.opacity = 0.5;
		spinnerWrapperEl.style.display = 'flex';
		var result = await eel.test_sheets(sheetName)();

		showAlertModal(result);
	} catch (e) {
		showAlertModal(e);
	} finally {
		spinnerWrapperEl.style.opacity = 0;

		setTimeout(() => {
			spinnerWrapperEl.style.display = 'none';			
		}, 200);
	}
}