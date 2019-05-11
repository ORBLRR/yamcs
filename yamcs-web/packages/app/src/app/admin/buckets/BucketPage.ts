import { SelectionModel } from '@angular/cdk/collections';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { MatDialog, MatTableDataSource } from '@angular/material';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { ListObjectsOptions, ListObjectsResponse, StorageClient } from '@yamcs/client';
import { BehaviorSubject, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { YamcsService } from '../../core/services/YamcsService';
import * as dnd from '../../shared/dnd';
import { RenameObjectDialog } from './RenameObjectDialog';
import { UploadObjectsDialog } from './UploadObjectsDialog';

@Component({
  templateUrl: './BucketPage.html',
  styleUrls: ['./BucketPage.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BucketPage implements OnDestroy {

  @ViewChild('droparea')
  dropArea: ElementRef;

  bucketInstance: string;
  name: string;

  breadcrumb$ = new BehaviorSubject<BreadCrumbItem[]>([]);
  dragActive$ = new BehaviorSubject<boolean>(false);

  displayedColumns = ['select', 'name', 'size', 'modified', 'actions'];
  dataSource = new MatTableDataSource<BrowseItem>([]);
  selection = new SelectionModel<BrowseItem>(true, []);

  private routerSubscription: Subscription;
  private storageClient: StorageClient;

  constructor(
    private dialog: MatDialog,
    router: Router,
    private route: ActivatedRoute,
    yamcs: YamcsService,
    title: Title,
  ) {
    this.bucketInstance = route.snapshot.parent!.paramMap.get('instance')!;
    this.name = route.snapshot.parent!.paramMap.get('name')!;
    title.setTitle(name + ' - Yamcs');
    this.storageClient = yamcs.createStorageClient();

    this.loadCurrentFolder();
    this.routerSubscription = router.events.pipe(
      filter(evt => evt instanceof NavigationEnd)
    ).subscribe(() => {
      this.loadCurrentFolder();
    });
  }

  private loadCurrentFolder() {
    const options: ListObjectsOptions = {
      delimiter: '/',
    };
    console.log('current folder', this.route.snapshot.url);
    const routeSegments = this.route.snapshot.url;
    if (routeSegments.length) {
      options.prefix = routeSegments.map(s => s.path).join('/') + '/';
    }

    this.storageClient.listObjects(this.bucketInstance, this.name, options).then(dir => {
      this.updateBrowsePath();
      this.changedir(dir);
    });
  }

  private changedir(dir: ListObjectsResponse) {
    this.selection.clear();
    const items: BrowseItem[] = [];
    for (const prefix of dir.prefix || []) {
      items.push({
        folder: true,
        name: prefix,
      });
    }
    for (const object of dir.object || []) {
      items.push({
        folder: false,
        name: object.name,
        modified: object.created,
        size: object.size,
        objectUrl: this.storageClient.getObjectURL(this.bucketInstance, this.name, object.name),
      });
    }
    this.dataSource.data = items;
  }

  isAllSelected() {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows && numRows > 0;
  }

  masterToggle() {
    this.isAllSelected() ?
        this.selection.clear() :
        this.dataSource.data.forEach(row => this.selection.select(row));
  }

  toggleOne(row: BrowseItem) {
    if (!this.selection.isSelected(row) || this.selection.selected.length > 1) {
      this.selection.clear();
    }
    this.selection.toggle(row);
  }

  uploadObjects() {
    const dialogRef = this.dialog.open(UploadObjectsDialog, {
      width: '400px',
      data: {
        bucketInstance: this.bucketInstance,
        bucket: this.name,
        path: this.getCurrentPath(),
      }
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadCurrentFolder();
      }
    });
  }

  private getCurrentPath() {
    let path = '';
    for (const segment of this.route.snapshot.url) {
      path += '/' + segment.path;
    }
    return path || '/';
  }

  deleteSelectedObjects() {
    const deletableObjects: string[] = [];
    const findObjectPromises = [];
    for (const item of this.selection.selected) {
      if (item.folder) {
        findObjectPromises.push(this.storageClient.listObjects(this.bucketInstance, this.name, {
          prefix: item.name,
        }).then(response => {
          const objects = response.object || [];
          deletableObjects.push(...objects.map(o => o.name));
        }));
      } else {
        deletableObjects.push(item.name);
      }
    }

    Promise.all(findObjectPromises).then(() => {
      if (confirm(`You are about to delete ${deletableObjects.length} files. Are you sure you want to continue?`)) {
        const deletePromises = [];
        for (const object of deletableObjects) {
          deletePromises.push(this.storageClient.deleteObject(this.bucketInstance, this.name, object));
        }

        Promise.all(deletePromises).then(() => {
          this.loadCurrentFolder();
        });
      }
    });
  }

  renameFile(item: BrowseItem) {
    const dialogRef = this.dialog.open(RenameObjectDialog, {
      data: {
        bucketInstance: this.bucketInstance,
        bucket: this.name,
        name: item.name,
      },
      width: '400px',
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadCurrentFolder();
      }
    });
  }

  deleteFile(item: BrowseItem) {
    if (confirm(`Are you sure you want to delete ${item.name}?`)) {
      this.storageClient.deleteObject(this.bucketInstance, 'displays', item.name).then(() => {
        this.loadCurrentFolder();
      });
    }
  }

  dragEnter(evt: DragEvent) {
    this.dragActive$.next(true);
    evt.preventDefault();
    evt.stopPropagation();
    return false;
  }

  dragOver(evt: DragEvent) { // This event must be prevented. Otherwise drop doesn't trigger.
    evt.preventDefault();
    evt.stopPropagation();
    return false;
  }

  dragLeave(evt: DragEvent) {
    this.dragActive$.next(false);
    evt.preventDefault();
    evt.stopPropagation();
    return false;
  }

  drop(evt: DragEvent) {
    const dataTransfer: any = evt.dataTransfer || {};
    if (dataTransfer) {
      let objectPrefix = this.getCurrentPath().substring(1);
      if (objectPrefix !== '') {
        objectPrefix += '/';
      }

      dnd.listDroppedFiles(dataTransfer).then(droppedFiles => {
        const uploadPromises: any[] = [];
        for (const droppedFile of droppedFiles) {
          const objectPath = objectPrefix + droppedFile._fullPath;
          const promise = this.storageClient.uploadObject(this.bucketInstance, this.name, objectPath, droppedFile);
          uploadPromises.push(promise);
        }
        Promise.all(uploadPromises).finally(() => {
          this.loadCurrentFolder();
        });
      });
    }
    this.dragActive$.next(false);
    evt.preventDefault();
    evt.stopPropagation();
    return false;
  }

  private updateBrowsePath() {
    const breadcrumb: BreadCrumbItem[] = [];
    let path = '';
    for (const segment of this.route.snapshot.url) {
      path += '/' + segment.path;
      breadcrumb.push({
        name: segment.path,
        route: `/admin/buckets/${this.bucketInstance}/${this.name}` + path,
      });
    }
    this.breadcrumb$.next(breadcrumb);
    return path || '/';
  }

  ngOnDestroy() {
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
  }
}

export class BrowseItem {
  folder: boolean;
  name: string;
  modified?: string;
  objectUrl?: string;
  size?: number;
}

export interface BreadCrumbItem {
  name: string;
  route: string;
}

