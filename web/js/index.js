function showAlertModal(content) {
	var alertModal = new bootstrap.Modal(document.getElementById('alertModal'), {
			keyboard: false
	});
	document.getElementById('alertMessage').textContent = content;
	alertModal.show();
}

function refreshLogo() {
    var logo = document.getElementById('logo');
    logo.src = "images/logo.png?t=" + new Date().getTime();
}