/** @odoo-module **/
// ProductScreen patch - extend, never rewrite:
//  1. Registers the FacetBar and CategoryTree components.
//  2. Exposes the button that opens the vertical tree.
//  3. Injects facet filtering over the visible product list.

import { patch } from "@web/core/utils/patch";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { DarakjianFacetBar } from "../app/facet_bar/facet_bar";
import { DarakjianCategoryTree } from "../app/category_tree/category_tree";
import { DarakjianBreadcrumb } from "../app/breadcrumb/breadcrumb";
import { DarakjianCaseSerialPicker } from "../app/case_serial_picker/case_serial_picker";

patch(ProductScreen, {
    components: {
        ...ProductScreen.components,
        DarakjianFacetBar,
        DarakjianCategoryTree,
        DarakjianBreadcrumb,
        DarakjianCaseSerialPicker,
    },
});

patch(ProductScreen.prototype, {
    openDarakjianTree() {
        this.pos.darakjianTreeOpen = true;
    },
    // Facet filtering does NOT belong here: the Odoo 19 grid iterates
    // pos.productToDisplayByCateg -> pos.productsToDisplay, both PosStore getters, and
    // never this component's `products` getter. The filter override lives in store.js
    // (PosStore.productsToDisplay), which is where it actually takes effect.

    /** Native: point_of_sale/app/screens/product_screen/product_screen.js. Intercepts
     *  the click on a product card, BEFORE anything is added to the order - only to
     *  reroute it to the Case/Serial picker, and only when that product actually has
     *  more than one unit on hand (darakjianNeedsCasePicker). Anything else falls
     *  through to super() untouched: same behavior as before this module existed. */
    async addProductToOrder(product) {
        if (this.pos.darakjianNeedsCasePicker(product)) {
            this.pos.darakjianCasePickerProduct = product;
            return;
        }
        return super.addProductToOrder(product);
    },

    /** Dedicated full-catalog search, bypassing the per-category load cap entirely
     *  (see darakjianSearchFullCatalog in store.js for why this exists). A native
     *  prompt() instead of an inline text input on purpose: the first version added a
     *  permanent text field to the toolbar and on touchscreens, focusing it pushed the
     *  whole product grid up every keystroke (confirmed in production, 2026-10-09) -
     *  prompt() runs as a browser-native modal outside the page's own layout flow, so
     *  it cannot trigger that reflow. */
    async darakjianSearchCatalog() {
        const query = window.prompt("Buscar en todo el catalogo:");
        if (!query) {
            return;
        }
        try {
            const found = await this.pos.darakjianSearchFullCatalog(query);
            // Loading a template into pos.models does not make it visible on its own -
            // the grid (productsToDisplay) still filters by whatever category is
            // selected (DarakjianCategoryTree seeds one on mount so the POS never opens
            // showing the full catalog at once). A cross-category name/code search has
            // to clear that selection, the same way DarakjianCategoryTree.clearCategory
            // does, or the newly loaded matches stay invisible in categories other than
            // the one currently selected - confirmed in production, 2026-10-10 (40
            // found, only 8 shown, all in the selected category).
            if (found > 0) {
                this.pos.selectedCategory = null;
            }
            window.alert(`Busqueda completa: ${found} producto(s) encontrado(s) para "${query}".`);
        } catch (e) {
            window.alert(`Error al buscar: ${e && e.message ? e.message : e}`);
            console.error("[Darakjian] darakjianSearchCatalog failed:", e);
        }
    },
});
