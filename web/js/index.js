function showAlertModal(content) {
	var alertModal = new bootstrap.Modal(document.getElementById('alertModal'), {
			keyboard: false
	});
	document.getElementById('alertMessage').textContent = content;
	alertModal.show();
}