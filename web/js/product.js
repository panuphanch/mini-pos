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
            <button class="btn btn-danger btn-sm" onclick="deleteProduct('${id}')">Delete</button>
        `;
    });

    $('#productTable').DataTable({
        "pageLength": 5,
        "lengthChange": false,
        "destroy": true
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
    const syncButton = document.getElementById('syncProductButton');
    syncButton.disabled = true;

    try
    {
        await eel.sync_products_to_google_sheet()();
        showAlertModal("Products synced successfully!");
    } catch (e) {
        showAlertModal("An error occurred while syncing products.");
    } finally {
        syncButton.disabled = false;
        loadProducts();
    }
}
