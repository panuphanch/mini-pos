async function loadProducts() {
    let products = await eel.load_products()(); // Call Python function
    displayProducts(products);
    loadProductData();
}

function displayProducts(products) {
    const currentPage = $('#productTable').DataTable().page();
    $('#productTable').DataTable().destroy();

    const productList = document.getElementById('products-list');
    productList.innerHTML = ''; // Clear existing product rows

    products.forEach(product => {
        const id = product[0]
        const name = product[1];
        const price = product[2];
        const row = productList.insertRow();
        const nameCell = row.insertCell();
        const priceCell = row.insertCell();
        const actionsCell = row.insertCell();
        actionsCell.classList.add('text-center');

        nameCell.textContent = name;
        priceCell.textContent = price;

        actionsCell.innerHTML = `
            <div class="d-flex justify-content-center">
                <button class="btn me-1" onclick="editProduct('${id}', '${name}', '${price}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="blue" class="bi bi-pencil-square" viewBox="0 0 16 16">
                        <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
                        <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/>
                    </svg>
                </button>
                <button class="btn" onclick="deleteProduct('${id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="red" class="bi bi-x-circle-fill" viewBox="0 0 16 16">
                        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"/>
                    </svg>
                </button>
            </div>
        `;
    });

    $('#productTable').DataTable({
        "pageLength": 5,
        "lengthChange": false,
        "destroy": true,
        "columnDefs": [
            { "orderable": false, "targets": [-1] }
        ]
    }).page(currentPage).draw('page');
}

async function addProduct(event) {
    event.preventDefault(); // Prevent default form submission

    const productNameInput = document.getElementById('product-name');
    const productPriceInput = document.getElementById('product-price');

    const productName = productNameInput.value;
    const productPrice = productPriceInput.value;

    await eel.add_product(productName, productPrice)(); // Call Python function

    productNameInput.value = '';
    productPriceInput.value = '';

    loadProducts();
}

async function editProduct(productId, productName, productPrice) {
    const editModal = new bootstrap.Modal(document.getElementById('editProductModal'));
    document.getElementById('product-id').value = productId;
    document.getElementById('edit-product-name').value = productName;
    document.getElementById('edit-product-price').value = productPrice;
    editModal.show();
}

async function submitEditForm() {
    const productId = document.getElementById('product-id').value;
    const newName = document.getElementById('edit-product-name').value;
    const newPrice = document.getElementById('edit-product-price').value;

    await eel.edit_product(productId, newName, newPrice)();
    bootstrap.Modal.getInstance(document.getElementById('editProductModal')).hide();
    loadProducts();
}

async function deleteProduct(productId) {    
    const confirmDeleteModal = new bootstrap.Modal(document.getElementById('confirmDeleteModal'));
    const confirmDeleteButton = document.getElementById('confirmDeleteButton');
    const confirmMessage = document.getElementById('confirmMessage');

    confirmMessage.innerText = "Are you sure you want to delete this product?";

    confirmDeleteButton.onclick = async function() {
        await eel.delete_product(productId)();
        loadProducts();
        confirmDeleteModal.hide();
    };

    confirmDeleteModal.show();
}

async function syncProduct() {
    const spinnerWrapperEl = document.querySelector('.spinner-wrapper');
    const syncButton = document.getElementById('syncProductButton');
    syncButton.disabled = true;

    try
    {
        spinnerWrapperEl.style.opacity = 0.5;
		spinnerWrapperEl.style.display = 'flex';
        await eel.sync_products_to_google_sheet()();
        showAlertModal("Products synced successfully!");
    } catch (e) {
        showAlertModal("An error occurred while syncing products.");
    } finally {
        syncButton.disabled = false;
        loadProducts();

        spinnerWrapperEl.style.opacity = 0;
		setTimeout(() => {
			spinnerWrapperEl.style.display = 'none';			
		}, 200);
    }
}
