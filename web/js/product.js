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
            <button class="btn" onclick="deleteProduct('${id}')">                
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="red" class="bi bi-x-circle-fill" viewBox="0 0 16 16">
                <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"/>
            </svg>
            </button>
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
